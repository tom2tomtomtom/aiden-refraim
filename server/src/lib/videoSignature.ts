import { open } from 'node:fs/promises';
import { VideoContainer } from '../config/uploadFormats';

// Top-level box/atom types that legitimately begin an ISO Base Media File
// (MP4/M4V) or a classic QuickTime (.mov) stream. The 4-byte type lives at
// offset 4; the first 4 bytes are the box size.
const ISO_BMFF_BOX_TYPES = new Set([
  'ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'styp',
]);

/**
 * Identify the container a buffer starts with, from its bytes.
 *
 * Multer's mimetype is derived from the client-supplied Content-Type and
 * extension, so a text file renamed to `.mp4` passes the mimetype filter.
 *
 * This reports the container rather than a yes/no, because "not a video" and
 * "a video we don't accept" need different answers: the first is a rejection,
 * the second is an instruction to convert.
 */
export function detectVideoContainer(buffer: Buffer): VideoContainer | null {
  if (buffer.length < 12) return null;

  // ISO Base Media (MP4/MOV/M4V) and classic QuickTime.
  if (ISO_BMFF_BOX_TYPES.has(buffer.toString('latin1', 4, 8))) return 'iso-bmff';

  // RIFF/AVI: 'RIFF' .... 'AVI '
  if (
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'AVI '
  ) {
    return 'avi';
  }

  // Matroska / WebM (EBML header).
  if (
    buffer[0] === 0x1a && buffer[1] === 0x45 &&
    buffer[2] === 0xdf && buffer[3] === 0xa3
  ) {
    return 'matroska';
  }

  // MPEG program stream / video: 0x000001BA (pack) or 0x000001B3 (seq header).
  if (
    buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 &&
    (buffer[3] === 0xba || buffer[3] === 0xb3)
  ) {
    return 'mpeg-ps';
  }

  // FLV.
  if (buffer.toString('latin1', 0, 3) === 'FLV') return 'flv';

  return null;
}

/** True when the bytes begin with any recognised video container. */
export function hasVideoSignature(buffer: Buffer): boolean {
  return detectVideoContainer(buffer) !== null;
}

/** Reads the head of a file on disk and identifies its container. */
export async function detectFileVideoContainer(
  filePath: string,
): Promise<VideoContainer | null> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, 16, 0);
    return detectVideoContainer(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export async function fileHasVideoSignature(filePath: string): Promise<boolean> {
  return (await detectFileVideoContainer(filePath)) !== null;
}
