const mockAnalyzeVideo = jest.fn();
const mockGetSignedUrl = jest.fn();
const mockProcessVideo = jest.fn();

jest.mock('../../services/videoAnalysisService', () => ({
  analyzeVideo: (...args: unknown[]) => mockAnalyzeVideo(...args),
}));

jest.mock('../../services/storageService', () => ({
  StorageService: {
    getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
  },
}));

jest.mock('../../services/ffmpegService', () => ({
  FFmpegService: {
    processVideo: (...args: unknown[]) => mockProcessVideo(...args),
  },
}));

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
  },
}));

jest.mock('../../config/supabase', () => ({
  supabase: {
    from: () => ({
      update: () => {
        const chain: any = {};
        chain.eq = () => chain;
        chain.in = () => chain;
        chain.contains = () => chain;
        chain.select = () => chain;
        chain.maybeSingle = () => Promise.resolve({ data: { id: 'video-1' }, error: null });
        return chain;
      },
    }),
  },
}));

import { videoProcessor, SourceTooLargeError } from '../../services/videoProcessingService';
import { MAX_SOURCE_DURATION_SECONDS, MAX_SOURCE_PIXELS } from '../../config/mediaLimits';

const video = {
  id: 'video-1',
  user_id: 'user-1',
  original_url: 'original/video-1.mp4',
  status: 'UPLOADED' as const,
  platforms: ['instagram-story'],
};

const analysisFor = (duration: number, width: number, height: number) => ({
  focusRegion: { x: 0, y: 0, width, height },
  metadata: { duration, fps: 30, resolution: { width, height } },
});

const runExport = (platforms = ['instagram-story']) => videoProcessor.process(
  video,
  platforms,
  { jobId: 'job-1', billingPath: 'gateway_tokens', beforePublish: mockBeforePublish },
);

const mockBeforePublish = jest.fn();

// A video uploaded before the caps existed still reaches the pipeline. This is
// the last gate in front of the per-platform loop, where one oversized source
// would otherwise be re-encoded once per requested platform.
describe('pipeline refuses to render a source past the input caps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSignedUrl.mockResolvedValue('https://signed.example/video.mp4');
    mockProcessVideo.mockResolvedValue('processed/video-1-story.mp4');
  });

  it('throws before any re-encode when the source is too long', async () => {
    mockAnalyzeVideo.mockResolvedValue(
      analysisFor(MAX_SOURCE_DURATION_SECONDS + 1, 1920, 1080),
    );

    await expect(runExport()).rejects.toBeInstanceOf(SourceTooLargeError);
    expect(mockProcessVideo).not.toHaveBeenCalled();
    expect(mockBeforePublish).not.toHaveBeenCalled();
  });

  it('throws before any re-encode when the source has too many pixels', async () => {
    mockAnalyzeVideo.mockResolvedValue(analysisFor(10, 7680, 4320));

    await expect(runExport()).rejects.toBeInstanceOf(SourceTooLargeError);
    expect(mockProcessVideo).not.toHaveBeenCalled();
    expect(mockBeforePublish).not.toHaveBeenCalled();
  });

  it('does not multiply the refusal by the number of requested platforms', async () => {
    mockAnalyzeVideo.mockResolvedValue(
      analysisFor(MAX_SOURCE_DURATION_SECONDS * 20, 1920, 1080),
    );

    await expect(
      runExport(['instagram-story', 'tiktok', 'youtube-shorts', 'facebook-feed']),
    ).rejects.toBeInstanceOf(SourceTooLargeError);
    expect(mockProcessVideo).not.toHaveBeenCalled();
  });

  it('renders a source that sits inside both caps', async () => {
    mockAnalyzeVideo.mockResolvedValue(
      analysisFor(MAX_SOURCE_DURATION_SECONDS - 1, 1920, 1080),
    );

    const outcome = await runExport();

    expect(outcome).toEqual({ successfulOutputs: 1, failedOutputs: 0 });
    expect(mockProcessVideo).toHaveBeenCalledTimes(1);
  });

  it('renders a source exactly at the pixel cap', async () => {
    mockAnalyzeVideo.mockResolvedValue(analysisFor(10, 3840, MAX_SOURCE_PIXELS / 3840));

    await expect(runExport()).resolves.toMatchObject({ successfulOutputs: 1 });
  });
});
