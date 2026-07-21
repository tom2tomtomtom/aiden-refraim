import { open } from 'node:fs/promises';

// Top-level box/atom types that legitimately begin an ISO Base Media File
// (MP4/M4V) or a classic QuickTime (.mov) stream. The 4-byte type lives at
// offset 4; the first 4 bytes are the box size.
const ISO_BMFF_BOX_TYPES = new Set([
  'ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'styp',
]);

/**
 * Content-based check that a buffer begins with a known video container
 * signature. Multer's mimetype is derived from the client-supplied
 * Content-Type / extension, so a text file renamed to `.mp4` passes the
 * mimetype filter. This inspects the actual bytes instead.
 */
export function hasVideoSignature(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;

  // ISO Base Media (MP4/MOV/M4V) and classic QuickTime.
  if (ISO_BMFF_BOX_TYPES.has(buffer.toString('latin1', 4, 8))) return true;

  // RIFF/AVI: 'RIFF' .... 'AVI '
  if (
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'AVI '
  ) {
    return true;
  }

  // Matroska / WebM (EBML header).
  if (
    buffer[0] === 0x1a && buffer[1] === 0x45 &&
    buffer[2] === 0xdf && buffer[3] === 0xa3
  ) {
    return true;
  }

  // MPEG program stream / video: 0x000001BA (pack) or 0x000001B3 (seq header).
  if (
    buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 &&
    (buffer[3] === 0xba || buffer[3] === 0xb3)
  ) {
    return true;
  }

  // FLV.
  if (buffer.toString('latin1', 0, 3) === 'FLV') return true;

  return false;
}

/** Reads the head of a file on disk and checks it for a video signature. */
export async function fileHasVideoSignature(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, 16, 0);
    return hasVideoSignature(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}
