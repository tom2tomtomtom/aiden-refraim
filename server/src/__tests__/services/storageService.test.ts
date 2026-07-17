import path from 'path';
import fs from 'fs';

// Mock supabase before importing StorageService
jest.mock('../../config/supabase', () => ({
  supabase: {
    storage: {
      listBuckets: jest.fn().mockResolvedValue({ data: [{ name: 'videos' }], error: null }),
      updateBucket: jest.fn().mockResolvedValue({ error: null }),
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({ data: { path: 'original/test.mp4' }, error: null }),
        getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/test.mp4' } }),
        createSignedUrl: jest.fn().mockResolvedValue({
          data: { signedUrl: 'https://example.com/storage/v1/object/sign/videos/original/test.mp4?token=sig' },
          error: null,
        }),
      })),
    },
  },
}));

// Mock fs
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn().mockReturnValue(true),
    statSync: jest.fn().mockReturnValue({ size: 1024, birthtime: new Date(), mtime: new Date() }),
    readFileSync: jest.fn().mockReturnValue(Buffer.from('fake-video-data')),
    unlinkSync: jest.fn(),
    promises: {
      ...actual.promises,
      // uploadVideo reads via fs.promises.readFile (non-blocking); the sync
      // mock alone left these tests reading a real (missing) /tmp file.
      readFile: jest.fn().mockResolvedValue(Buffer.from('fake-video-data')),
    },
  };
});

import { StorageService } from '../../services/storageService';

describe('StorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadVideo', () => {
    it('rejects files without allowed extensions', async () => {
      await expect(
        StorageService.uploadVideo('/tmp/test.txt', 'video.txt')
      ).rejects.toThrow('Invalid file extension: .txt');
    });

    it('rejects files larger than 500MB', async () => {
      const bigSize = 501 * 1024 * 1024;
      (fs.statSync as jest.Mock).mockReturnValueOnce({
        size: bigSize,
        birthtime: new Date(),
        mtime: new Date(),
      });

      await expect(
        StorageService.uploadVideo('/tmp/big.mp4', 'big.mp4')
      ).rejects.toThrow('File too large');
    });

    it('generates unique filename with timestamp and random string', async () => {
      const { supabase } = require('../../config/supabase');

      let uploadedPath = '';
      supabase.storage.from.mockReturnValue({
        upload: jest.fn((storagePath: string) => {
          uploadedPath = storagePath;
          return Promise.resolve({ data: { path: storagePath }, error: null });
        }),
        getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/test.mp4' } }),
      });

      await StorageService.uploadVideo('/tmp/test.mp4', 'my-video.mp4');

      // Path should be original/<timestamp>-<random>.mp4
      expect(uploadedPath).toMatch(/^original\/\d+-[a-z0-9]+\.mp4$/);
    });
  });

  describe('validateFile (via uploadVideo)', () => {
    it('returns error for non-video extensions (.pdf)', async () => {
      await expect(
        StorageService.uploadVideo('/tmp/doc.pdf', 'document.pdf')
      ).rejects.toThrow('Invalid file extension: .pdf');
    });

    it('accepts .mp4 files', async () => {
      const url = await StorageService.uploadVideo('/tmp/test.mp4', 'video.mp4');
      expect(url).toBe('https://example.com/test.mp4');
    });

    it('accepts .mov files', async () => {
      const url = await StorageService.uploadVideo('/tmp/test.mov', 'video.mov');
      expect(url).toBe('https://example.com/test.mp4');
    });

    it('accepts .avi files', async () => {
      const url = await StorageService.uploadVideo('/tmp/test.avi', 'video.avi');
      expect(url).toBe('https://example.com/test.mp4');
    });
  });

  /**
   * UXA-20260717 F-012 regression contract: exports live in a PRIVATE bucket
   * and every read is a short-lived signed URL. Before the fix the bucket was
   * forced public and raw public URLs were returned to clients.
   */
  describe('F-012: private bucket + signed URLs', () => {
    const PUB = 'https://proj.supabase.co/storage/v1/object/public/videos/processed/ab/video.mp4';
    const SIGN = 'https://proj.supabase.co/storage/v1/object/sign/videos/processed/ab/video.mp4?token=x';

    beforeEach(() => {
      // An earlier test replaces the storage.from factory via mockReturnValue,
      // dropping createSignedUrl; restore the full surface for this block.
      const { supabase } = require('../../config/supabase');
      supabase.storage.from.mockImplementation((bucket: string) => ({
        upload: jest.fn().mockResolvedValue({ data: { path: 'original/test.mp4' }, error: null }),
        getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/test.mp4' } }),
        createSignedUrl: jest.fn((p: string) => Promise.resolve({
          data: { signedUrl: `https://proj.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=sig` },
          error: null,
        })),
      }));
    });

    it('ensureBucketExists enforces public:false (never public:true)', async () => {
      const { supabase } = require('../../config/supabase');
      await StorageService.ensureBucketExists();
      expect(supabase.storage.updateBucket).toHaveBeenCalledWith(
        'videos',
        expect.objectContaining({ public: false }),
      );
      const anyPublicTrue = (supabase.storage.updateBucket as jest.Mock).mock.calls
        .some(([, opts]: [string, { public?: boolean }]) => opts?.public === true);
      expect(anyPublicTrue).toBe(false);
    });

    it('pathFromUrl extracts the object path from public, signed, and authenticated forms', () => {
      expect(StorageService.pathFromUrl(PUB)).toBe('processed/ab/video.mp4');
      expect(StorageService.pathFromUrl(SIGN)).toBe('processed/ab/video.mp4');
      expect(StorageService.pathFromUrl('https://elsewhere.com/video.mp4')).toBeNull();
    });

    it('getSignedUrl mints a signed URL from a stored public-form URL', async () => {
      const url = await StorageService.getSignedUrl(PUB);
      expect(url).toContain('/object/sign/');
      expect(url).toContain('token=');
    });

    it('signVideoRecord signs original_url and every platform output URL', async () => {
      const video = {
        original_url: PUB,
        platform_outputs: {
          'instagram-story': { url: PUB, status: 'complete' },
          'tiktok': { url: PUB, status: 'complete' },
        },
      };
      const signed = await StorageService.signVideoRecord(video as any);
      expect(signed.original_url).toContain('/object/sign/');
      expect(signed.platform_outputs?.['instagram-story'].url).toContain('/object/sign/');
      expect(signed.platform_outputs?.['tiktok'].url).toContain('/object/sign/');
    });

    it('signVideoRecord leaves foreign URLs untouched', async () => {
      const video = { original_url: 'https://elsewhere.com/clip.mp4' };
      const signed = await StorageService.signVideoRecord(video as any);
      expect(signed.original_url).toBe('https://elsewhere.com/clip.mp4');
    });
  });
});
