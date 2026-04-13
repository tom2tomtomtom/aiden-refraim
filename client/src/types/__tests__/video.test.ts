import { describe, it, expect } from 'vitest';
import { OUTPUT_FORMATS } from '../video';

describe('OUTPUT_FORMATS', () => {
  it('has 8 platform entries', () => {
    expect(Object.keys(OUTPUT_FORMATS)).toHaveLength(8);
  });

  it('each format has required fields (name, aspectRatio, width, height, platform, type)', () => {
    const requiredFields = ['name', 'aspectRatio', 'width', 'height', 'platform', 'type'];

    for (const [key, format] of Object.entries(OUTPUT_FORMATS)) {
      for (const field of requiredFields) {
        expect(format).toHaveProperty(field);
        expect((format as Record<string, unknown>)[field]).toBeDefined();
      }
    }
  });

  it('instagram-story has 9:16 aspect ratio', () => {
    expect(OUTPUT_FORMATS['instagram-story'].aspectRatio).toBe('9:16');
  });

  it('tiktok has 9:16 aspect ratio', () => {
    expect(OUTPUT_FORMATS['tiktok'].aspectRatio).toBe('9:16');
  });

  it('youtube-main has 16:9 aspect ratio', () => {
    expect(OUTPUT_FORMATS['youtube-main'].aspectRatio).toBe('16:9');
  });
});
