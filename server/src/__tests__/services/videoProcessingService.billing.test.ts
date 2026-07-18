const mockAnalyzeVideo = jest.fn();
const mockGetSignedUrl = jest.fn();
const mockProcessVideo = jest.fn();
const mockDbUpdates: Array<{ table: string; data: Record<string, unknown> }> = [];

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
    from: (table: string) => ({
      update: (data: Record<string, unknown>) => {
        mockDbUpdates.push({ table, data });
        return {
          eq: jest.fn().mockResolvedValue({ error: null }),
        };
      },
    }),
  },
}));

import { videoProcessor } from '../../services/videoProcessingService';

const video = {
  id: 'video-1',
  user_id: 'user-1',
  original_url: 'original/video-1.mp4',
  status: 'UPLOADED' as const,
  platforms: ['instagram-story'],
};

describe('video processing billing publication boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbUpdates.length = 0;
    mockAnalyzeVideo.mockResolvedValue({ metadata: {} });
    mockGetSignedUrl.mockResolvedValue('https://signed.example/video.mp4');
  });

  it('waits for settlement before publishing successful output or a terminal state', async () => {
    const order: string[] = [];
    mockProcessVideo.mockResolvedValue('processed/video-1-story.mp4');

    const outcome = await videoProcessor.process(
      video,
      ['instagram-story'],
      async () => {
        order.push('settled');
        expect(
          mockDbUpdates.some(({ table, data }) =>
            table === 'videos'
              && Object.prototype.hasOwnProperty.call(data, 'platform_outputs')),
        ).toBe(false);
      },
    );

    const terminalUpdate = mockDbUpdates.find(({ table, data }) =>
      table === 'videos' && data.status === 'completed');
    if (terminalUpdate) order.push('terminal');

    expect(outcome).toEqual({ successfulOutputs: 1, failedOutputs: 0 });
    expect(order).toEqual(['settled', 'terminal']);
  });

  it('publishes an all-failed result without invoking settlement', async () => {
    const settle = jest.fn();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockProcessVideo.mockRejectedValue(new Error('ffmpeg failed'));

    const outcome = await videoProcessor.process(video, ['instagram-story'], settle);

    expect(outcome).toEqual({ successfulOutputs: 0, failedOutputs: 1 });
    expect(settle).not.toHaveBeenCalled();
    expect(mockDbUpdates).toContainEqual(expect.objectContaining({
      table: 'videos',
      data: expect.objectContaining({ status: 'failed' }),
    }));
    consoleError.mockRestore();
  });

  it('publishes a failed video state when token settlement is rejected', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockProcessVideo.mockResolvedValue('processed/video-1-story.mp4');

    await expect(videoProcessor.process(
      video,
      ['instagram-story'],
      async () => { throw new Error('settlement failed'); },
    )).rejects.toThrow('settlement failed');

    expect(mockDbUpdates).toContainEqual(expect.objectContaining({
      table: 'videos',
      data: expect.objectContaining({ status: 'failed' }),
    }));
    expect(mockDbUpdates.some(({ table, data }) =>
      table === 'videos'
        && Object.prototype.hasOwnProperty.call(data, 'platform_outputs')),
    ).toBe(false);
    consoleError.mockRestore();
  });
});
