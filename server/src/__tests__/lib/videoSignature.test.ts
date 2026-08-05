import { detectVideoContainer, hasVideoSignature } from '../../lib/videoSignature';
import {
  SUPPORTED_CONTAINERS,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_MIME_TYPES,
  isSupportedContainer,
  unsupportedContainerMessage,
} from '../../config/uploadFormats';

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

/**
 * F-054: the sniffer accepted Matroska while storage accepted only
 * mp4/mov/avi, so a valid .mkv or .webm cleared every early gate and then
 * failed inside the storage call as an opaque 500.
 */
describe('detectVideoContainer', () => {
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(8)]);

  it('names the container instead of answering yes or no', () => {
    expect(detectVideoContainer(box('ftyp'))).toBe('iso-bmff');
    expect(detectVideoContainer(webm)).toBe('matroska');
    expect(detectVideoContainer(Buffer.from('FLV\x01\x05\x00\x00\x00\x09\x00\x00\x00\x00', 'latin1')))
      .toBe('flv');
    expect(detectVideoContainer(Buffer.from('plain text, not a video at all', 'utf8'))).toBeNull();
  });

  it('separates "not a video" from "a video we cannot take"', () => {
    // Both used to be indistinguishable to the caller: one boolean.
    expect(isSupportedContainer(detectVideoContainer(box('ftyp')))).toBe(true);
    expect(isSupportedContainer(detectVideoContainer(webm))).toBe(false);
    expect(isSupportedContainer(null)).toBe(false);
  });

  it('tells a Matroska uploader what to do about it', () => {
    const message = unsupportedContainerMessage('matroska');
    expect(message).toContain('Matroska or WebM');
    expect(message).toContain('MP4, MOV, or AVI');
  });
});

describe('upload allow-lists agree with each other', () => {
  it('accepts exactly the containers the storage extensions describe', () => {
    expect([...SUPPORTED_CONTAINERS].sort()).toEqual(['avi', 'iso-bmff']);
    expect([...SUPPORTED_EXTENSIONS].sort()).toEqual(['.avi', '.mov', '.mp4']);
    expect([...SUPPORTED_MIME_TYPES].sort())
      .toEqual(['video/mp4', 'video/quicktime', 'video/x-msvideo']);
  });

  it('recognises more containers than it accepts, on purpose', () => {
    // The sniffer must still identify Matroska, MPEG-PS and FLV: that is how
    // the handler can name them in the rejection rather than saying 500.
    const recognised = ['iso-bmff', 'avi', 'matroska', 'mpeg-ps', 'flv'] as const;
    const rejected = recognised.filter((c) => !SUPPORTED_CONTAINERS.has(c));
    expect(rejected).toEqual(['matroska', 'mpeg-ps', 'flv']);
  });
});
