import { EventEmitter } from 'events';

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

// A ceiling short enough to assert against with real timers. The production
// values are derived from source duration and are minutes, not milliseconds.
jest.mock('../../config/mediaLimits', () => ({
  PROBE_TIMEOUT_MS: 50,
  renderTimeoutMs: () => 50,
}));

import { FFmpegService } from '../../services/ffmpegService';

type FakeProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock;
};

const fakeProcess = (): FakeProcess => {
  const proc = new EventEmitter() as FakeProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  return proc;
};

const probeSuccess = (proc: FakeProcess) => {
  setImmediate(() => {
    proc.stdout.emit('data', Buffer.from(JSON.stringify({
      streams: [{ width: 1920, height: 1080, duration: '10', r_frame_rate: '30/1' }],
    })));
    proc.emit('close', 0);
  });
};

const runProcessVideo = () => FFmpegService.processVideo(
  'https://signed.example/input.mp4?token=sig',
  '/tmp/out.mp4',
  { width: 1080, height: 1920, aspectRatio: '9:16' },
  { x: 0, y: 0, width: 1920, height: 1080 },
  'tiktok',
);

// Every assertion here would time out rather than fail before the spawn guard
// existed: the promises settled only from 'close', which these processes never
// emit.
describe('FFmpegService settles when a media process never closes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { StorageService } = require('../../services/storageService');
    StorageService.downloadVideo.mockResolvedValue(undefined);
    StorageService.uploadProcessedVideo.mockResolvedValue('processed/out.mp4');
  });

  it('rejects when ffprobe cannot be started', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = fakeProcess();
      setImmediate(() => proc.emit('error', new Error('spawn ffprobe ENOENT')));
      return proc;
    });

    await expect(runProcessVideo()).rejects.toThrow('spawn ffprobe ENOENT');
  });

  it('rejects when the render process cannot be started', async () => {
    mockSpawn.mockImplementation((command: string) => {
      const proc = fakeProcess();
      if (command === 'ffprobe') {
        probeSuccess(proc);
      } else {
        setImmediate(() => proc.emit('error', new Error('spawn ffmpeg EACCES')));
      }
      return proc;
    });

    await expect(runProcessVideo()).rejects.toThrow('spawn ffmpeg EACCES');
  });

  it('kills and rejects a render that never exits', async () => {
    const renders: FakeProcess[] = [];
    mockSpawn.mockImplementation((command: string) => {
      const proc = fakeProcess();
      if (command === 'ffprobe') {
        probeSuccess(proc);
      } else {
        renders.push(proc);
      }
      return proc;
    });

    await expect(runProcessVideo()).rejects.toThrow(/exceeded its .* limit/);
    expect(renders).toHaveLength(1);
    expect(renders[0].kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('kills and rejects a probe that never exits', async () => {
    const probes: FakeProcess[] = [];
    mockSpawn.mockImplementation(() => {
      const proc = fakeProcess();
      probes.push(proc);
      return proc;
    });

    await expect(runProcessVideo()).rejects.toThrow(/exceeded its .* limit/);
    expect(probes[0].kill).toHaveBeenCalledWith('SIGKILL');
  });
});
