import { EventEmitter } from 'events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const mockSpawn = jest.fn();

jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

jest.mock('../../services/storageService', () => ({
  StorageService: {
    downloadVideo: jest.fn(),
    uploadProcessedVideo: jest.fn(),
  },
}));

jest.mock('../../config/supabase', () => ({
  supabase: {},
}));

import { FFmpegService } from '../../services/ffmpegService';
import { StorageService } from '../../services/storageService';

const mockDownload = StorageService.downloadVideo as jest.Mock;
const mockUpload = StorageService.uploadProcessedVideo as jest.Mock;

/**
 * Real files on a real filesystem. The whole defect was about files surviving
 * on disk, so asserting against a mocked fs would assert the wrong thing.
 */
describe('FFmpegService.processVideo temp file cleanup', () => {
  let workDir: string;
  let outputPath: string;
  /** Path the service chose for its source copy, captured from the download. */
  let sourceCopyPath: string;

  function spawnMock(ffmpegExitCode: number) {
    return (command: string, args: string[]) => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      setImmediate(() => {
        if (command === 'ffprobe') {
          proc.stdout.emit(
            'data',
            Buffer.from(
              JSON.stringify({
                streams: [{ width: 1920, height: 1080, duration: '10', r_frame_rate: '30/1' }],
              }),
            ),
          );
          proc.emit('close', 0);
          return;
        }
        if (ffmpegExitCode === 0) {
          writeFileSync(args[args.length - 1], 'rendered');
        }
        proc.emit('close', ffmpegExitCode);
      });
      return proc;
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    workDir = mkdtempSync(path.join(tmpdir(), 'refraim-cleanup-'));
    outputPath = path.join(workDir, 'out-instagram-story.mp4');
    sourceCopyPath = '';

    mockDownload.mockImplementation(async (_url: string, destination: string) => {
      sourceCopyPath = destination;
      writeFileSync(destination, 'source bytes');
    });
    mockUpload.mockResolvedValue('https://storage.example/processed.mp4');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    if (sourceCopyPath) rmSync(sourceCopyPath, { force: true });
  });

  function render() {
    return FFmpegService.processVideo(
      'https://signed.example/input.mp4?token=sig',
      outputPath,
      { width: 1080, height: 1920, aspectRatio: '9:16' },
      { x: 0, y: 0, width: 1920, height: 1080 },
      'instagram-story',
    );
  }

  it('deletes the source copy after a successful render', async () => {
    mockSpawn.mockImplementation(spawnMock(0));

    await render();

    expect(sourceCopyPath).toMatch(/^\/tmp\/input-/);
    expect(existsSync(sourceCopyPath)).toBe(false);
  });

  it('deletes the source copy when ffmpeg fails', async () => {
    mockSpawn.mockImplementation(spawnMock(1));

    await expect(render()).rejects.toThrow(/FFmpeg failed/);

    expect(existsSync(sourceCopyPath)).toBe(false);
  });

  it('deletes both copies when the upload fails after a good render', async () => {
    mockSpawn.mockImplementation(spawnMock(0));
    mockUpload.mockRejectedValue(new Error('storage unavailable'));

    await expect(render()).rejects.toThrow('storage unavailable');

    // uploadProcessedVideo deletes the render itself, but only once it has
    // succeeded, so a failed upload used to leave the render behind as well.
    expect(existsSync(sourceCopyPath)).toBe(false);
    expect(existsSync(outputPath)).toBe(false);
  });

  it('gives concurrent renders distinct source copies', async () => {
    mockSpawn.mockImplementation(spawnMock(0));
    const seen: string[] = [];
    mockDownload.mockImplementation(async (_url: string, destination: string) => {
      seen.push(destination);
      sourceCopyPath = destination;
      writeFileSync(destination, 'source bytes');
    });

    await Promise.all([render(), render()]);

    // Timestamped names collided for exports starting in the same
    // millisecond, and the first to finish deleted the other's source.
    expect(new Set(seen).size).toBe(2);
    for (const p of seen) expect(existsSync(p)).toBe(false);
  });
});
