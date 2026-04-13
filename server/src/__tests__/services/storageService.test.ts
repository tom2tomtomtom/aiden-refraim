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
});
