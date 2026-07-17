import { supabase } from '../config/supabase';
import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import axios from 'axios';

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'videos';

// UXA-20260717 F-012: exports can carry pre-release/NDA client creative, so
// the bucket is PRIVATE and every read goes through a short-lived signed URL.
// Stored rows keep the public-form URL as a stable path identifier only —
// fetching it raw returns 401/403 by design.
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export class StorageService {
  static async ensureBucketExists(): Promise<void> {
    try {
      // Check if bucket exists
      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      if (listError) throw listError;

      const bucketExists = buckets.some(b => b.name === STORAGE_BUCKET);
      if (!bucketExists) {
        console.log(`Creating storage bucket: ${STORAGE_BUCKET}`);
        const { error: createError } = await supabase.storage.createBucket(STORAGE_BUCKET, {
          public: false,
          allowedMimeTypes: ['video/mp4', 'video/quicktime', 'video/x-msvideo']
        });
        if (createError) throw createError;
      }

      // Enforce private access; reads use signed URLs (F-012).
      const { error: updateError } = await supabase.storage.updateBucket(STORAGE_BUCKET, {
        public: false,
        allowedMimeTypes: ['video/mp4', 'video/quicktime', 'video/x-msvideo']
      });
      if (updateError) throw updateError;

    } catch (error) {
      console.error('Error ensuring bucket exists:', error);
      throw error;
    }
  }

  /**
   * Extract the object path from any URL form this bucket has ever issued
   * (public, signed, or authenticated). Returns null for foreign URLs.
   */
  static pathFromUrl(url: string): string | null {
    for (const form of ['public', 'sign', 'authenticated']) {
      const marker = `/storage/v1/object/${form}/${STORAGE_BUCKET}/`;
      const idx = url.indexOf(marker);
      if (idx !== -1) {
        const p = url.slice(idx + marker.length).split('?')[0];
        return p || null;
      }
    }
    return null;
  }

  /**
   * Mint a short-lived signed URL for a stored object. Accepts either a raw
   * object path or any URL form previously issued for this bucket. Returns
   * null when the input isn't ours or signing fails (callers keep the
   * original value and the read fails visibly rather than silently).
   */
  static async getSignedUrl(
    urlOrPath: string,
    expiresIn: number = SIGNED_URL_TTL_SECONDS,
  ): Promise<string | null> {
    // Full URLs must belong to our bucket; anything else (a foreign host,
    // an already-external asset) is not ours to sign. Bare object paths are
    // signed directly.
    const isUrl = /^https?:\/\//i.test(urlOrPath);
    const path = isUrl ? this.pathFromUrl(urlOrPath) : urlOrPath;
    if (!path) return null;

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) {
      console.error('[storage] createSignedUrl failed:', path, error);
      return null;
    }
    return data.signedUrl;
  }

  /**
   * Best-effort re-sign of every storage URL on a video row (original_url +
   * platform_outputs[*].url) for API responses. Leaves foreign URLs and
   * unsignable values untouched.
   */
  static async signVideoRecord<T extends {
    original_url?: string | null;
    platform_outputs?: Record<string, { url?: string } & Record<string, unknown>> | null;
  }>(video: T): Promise<T> {
    const out: T = { ...video };
    if (out.original_url) {
      const signed = await this.getSignedUrl(out.original_url);
      if (signed) out.original_url = signed;
    }
    if (out.platform_outputs) {
      const entries = await Promise.all(
        Object.entries(out.platform_outputs).map(async ([platform, output]) => {
          if (output?.url) {
            const signed = await this.getSignedUrl(output.url);
            if (signed) return [platform, { ...output, url: signed }] as const;
          }
          return [platform, output] as const;
        }),
      );
      out.platform_outputs = Object.fromEntries(entries);
    }
    return out;
  }

  static async uploadVideo(filePath: string, fileName: string): Promise<string> {
    console.log('Starting video upload process:', { filePath, fileName });

    try {
      // 1. Validate input
      if (!filePath || !fileName) {
        throw new Error('File path and name are required');
      }

      const fileExt = path.extname(fileName).toLowerCase();
      const allowedExtensions = ['.mp4', '.mov', '.avi'];
      if (!allowedExtensions.includes(fileExt)) {
        throw new Error(`Invalid file extension: ${fileExt}. Allowed: ${allowedExtensions.join(', ')}`);
      }

      // 2. Ensure bucket exists
      console.log('Verifying storage bucket...');
      await this.ensureBucketExists();

      // 3. Validate file
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found at path: ${filePath}`);
      }

      const stats = fs.statSync(filePath);
      console.log('File stats:', {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      });

      // Size limit: 500MB
      const MAX_SIZE = 500 * 1024 * 1024;
      if (stats.size > MAX_SIZE) {
        throw new Error(`File too large: ${stats.size} bytes. Maximum size: ${MAX_SIZE} bytes`);
      }

      // 4. Read and upload file
      // Use async readFile instead of readFileSync to avoid blocking the
      // event loop for seconds on 100MB+ uploads. Before this, the server
      // would stall ALL other HTTP requests while multer's temp file was
      // being slurped into memory. One upload could freeze the whole
      // container for half a minute.
      console.log('Reading file...');
      const readStart = Date.now();
      const fileBuffer = await fs.promises.readFile(filePath);
      const readMs = Date.now() - readStart;

      const uniqueFileName = `${Date.now()}-${Math.random().toString(36).substring(2)}${fileExt}`;
      const storagePath = `original/${uniqueFileName}`;

      console.log('Uploading to storage:', {
        bucket: STORAGE_BUCKET,
        path: storagePath,
        size: fileBuffer.length,
        type: this.getMimeType(fileExt),
        readMs,
      });

      // Upload file
      const uploadStart = Date.now();
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: this.getMimeType(fileExt),
          cacheControl: '3600',
          upsert: false
        });
      const uploadMs = Date.now() - uploadStart;
      console.log('Storage upload response:', {
        ok: !error,
        uploadMs,
        sizeBytes: fileBuffer.length,
        bytesPerSec: Math.round(fileBuffer.length / Math.max(1, uploadMs / 1000)),
      });

      if (error) {
        console.error('Storage upload error:', error);
        throw new Error(`Storage upload failed: ${error.message}`);
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(storagePath);

      if (!urlData?.publicUrl) {
        throw new Error('Failed to get public URL for uploaded file');
      }

      console.log('Upload successful:', {
        url: urlData.publicUrl,
        size: fileBuffer.length,
        type: this.getMimeType(fileExt)
      });

      // Clean up temporary file
      try {
        fs.unlinkSync(filePath);
        console.log('Temporary file cleaned up:', filePath);
      } catch (cleanupError) {
        console.warn('Failed to clean up temporary file:', cleanupError);
        // Don't throw error for cleanup failures
      }

      return urlData.publicUrl;
    } catch (error) {
      console.error('Video upload failed:', {
        error,
        filePath,
        fileName
      });
      throw error;
    }
  }

  private static getMimeType(fileExt: string): string {
    const mimeTypes: { [key: string]: string } = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo'
    };
    return mimeTypes[fileExt.toLowerCase()] || 'application/octet-stream';
  }

  static async uploadProcessedVideo(
    filePath: string,
    platform: string,
    originalFileName: string
  ): Promise<string> {
    try {
      // Read file as buffer
      const fileBuffer = fs.readFileSync(filePath);
      const fileExt = path.extname(originalFileName);
      const uniqueFileName = `${Date.now()}_${platform}${fileExt}`;
      
      console.log('Uploading processed video:', {
        bucket: STORAGE_BUCKET,
        path: `processed/${platform}/${uniqueFileName}`,
        size: fileBuffer.length
      });

      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(`processed/${platform}/${uniqueFileName}`, fileBuffer, {
          contentType: this.getMimeType(fileExt),
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('Storage upload error:', error);
        throw error;
      }

      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(`processed/${platform}/${uniqueFileName}`);

      if (!urlData?.publicUrl) {
        throw new Error('Failed to get public URL for processed video');
      }

      console.log('Processed video uploaded successfully:', urlData.publicUrl);

      // Clean up the temporary file
      await this.deleteFile(filePath);

      return urlData.publicUrl;
    } catch (error) {
      console.error('Error uploading processed video:', error);
      throw error;
    }
  }

  static async downloadVideo(videoUrl: string, outputPath: string): Promise<void> {
    try {
      // Our own bucket is private (F-012): a stored public-form URL will 401
      // if fetched raw, so mint a fresh signed URL first. Foreign URLs are
      // fetched as-is.
      const ownPath = this.pathFromUrl(videoUrl);
      const fetchUrl = ownPath ? await this.getSignedUrl(ownPath) : videoUrl;
      if (!fetchUrl) {
        throw new Error(`Could not sign storage URL for download: ${videoUrl}`);
      }

      const response = await axios({
        method: 'GET',
        url: fetchUrl,
        responseType: 'stream',
      });

      const writer = createWriteStream(outputPath);
      await pipeline(response.data, writer);
    } catch (error) {
      console.error('Error downloading video:', error);
      throw error;
    }
  }

  static async deleteVideo(videoUrl: string): Promise<void> {
    try {
      // Supabase public URLs look like:
      //   https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
      // The previous implementation used a regex literal with ${STORAGE_BUCKET}
      // interpolation, which doesn't interpolate inside a `/regex/` literal.
      // It matched the string "${STORAGE_BUCKET}", so every delete silently
      // failed with "Invalid video URL" and storage files were orphaned.
      // Accept every URL form this bucket has issued (public, signed,
      // authenticated) — rows written before and after the F-012 privacy
      // change must both delete cleanly.
      const filePath = this.pathFromUrl(videoUrl);
      if (!filePath) {
        console.warn(`[storage] deleteVideo: URL does not look like a ${STORAGE_BUCKET} object:`, videoUrl);
        return;
      }

      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([filePath]);

      if (error) throw error;
    } catch (error) {
      console.error('Error deleting video:', error);
      throw error;
    }
  }

  static async deleteFile(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error('Error deleting file:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  static async ensureDirectoryExists(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
  }
}
