import { supabase } from '../config/supabase';
import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import axios from 'axios';

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'videos';

export class StorageService {
  static async ensureBucketExists(): Promise<void> {
    try {
      // Check if bucket exists
      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      if (listError) throw listError;

      const bucketExists = buckets.some(b => b.name === STORAGE_BUCKET);
      if (!bucketExists) {
        console.log(`Creating storage bucket: ${STORAGE_BUCKET}`);
        const { data, error: createError } = await supabase.storage.createBucket(STORAGE_BUCKET, {
          public: true,
          allowedMimeTypes: ['video/mp4', 'video/quicktime', 'video/x-msvideo']
        });
        if (createError) throw createError;
      }

      // Update bucket to be public
      const { error: updateError } = await supabase.storage.updateBucket(STORAGE_BUCKET, {
        public: true,
        allowedMimeTypes: ['video/mp4', 'video/quicktime', 'video/x-msvideo']
      });
      if (updateError) throw updateError;

    } catch (error) {
      console.error('Error ensuring bucket exists:', error);
      throw error;
    }
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
      // being slurped into memory — one upload could freeze the whole
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
      const response = await axios({
        method: 'GET',
        url: videoUrl,
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
      // interpolation, which doesn't interpolate inside a `/regex/` literal —
      // it matched the string "${STORAGE_BUCKET}", so every delete silently
      // failed with "Invalid video URL" and storage files were orphaned.
      const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
      const markerIdx = videoUrl.indexOf(marker);
      if (markerIdx === -1) {
        console.warn(`[storage] deleteVideo: URL does not look like a ${STORAGE_BUCKET} object:`, videoUrl);
        return;
      }

      const filePath = videoUrl.slice(markerIdx + marker.length).split('?')[0];
      if (!filePath) {
        console.warn('[storage] deleteVideo: empty path after bucket marker:', videoUrl);
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
