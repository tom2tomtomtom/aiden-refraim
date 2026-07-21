import { hasVideoSignature } from '../../lib/videoSignature';

function box(type: string): Buffer {
  // 4-byte size + 4-byte box type + 4 bytes of payload padding.
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from(type, 'latin1'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
  ]);
}

describe('hasVideoSignature', () => {
  it('accepts an ISO BMFF (MP4/MOV) ftyp header', () => {
    expect(hasVideoSignature(box('ftyp'))).toBe(true);
  });

  it('accepts a classic QuickTime moov/mdat atom', () => {
    expect(hasVideoSignature(box('moov'))).toBe(true);
    expect(hasVideoSignature(box('mdat'))).toBe(true);
  });

  it('accepts a RIFF/AVI header', () => {
    const avi = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('AVI ', 'latin1'),
    ]);
    expect(hasVideoSignature(avi)).toBe(true);
  });

  it('accepts a Matroska/WebM EBML header', () => {
    const webm = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.alloc(8),
    ]);
    expect(hasVideoSignature(webm)).toBe(true);
  });

  it('rejects a text file renamed to .mp4', () => {
    const text = Buffer.from('this is not a video, it is plain text\n', 'utf8');
    expect(hasVideoSignature(text)).toBe(false);
  });

  it('rejects a RIFF container that is not AVI (e.g. WAV)', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'latin1'),
    ]);
    expect(hasVideoSignature(wav)).toBe(false);
  });

  it('rejects a buffer that is too short to identify', () => {
    expect(hasVideoSignature(Buffer.from([0x00, 0x00]))).toBe(false);
  });
});
