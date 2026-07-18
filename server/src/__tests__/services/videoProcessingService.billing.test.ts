const mockAnalyzeVideo = jest.fn();
const mockGetSignedUrl = jest.fn();
const mockProcessVideo = jest.fn();
const mockDbUpdates: Array<{ table: string; data: Record<string, unknown> }> = [];
const mockDbEquals: Array<{ table: string; column: string; value: unknown }> = [];
const mockDbContains: Array<{ table: string; column: string; value: unknown }> = [];
const mockOwnershipResults: Array<{ id: string } | null> = [];

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
        const chain: any = {};
        chain.eq = (column: string, value: unknown) => {
          mockDbEquals.push({ table, column, value });
          return chain;
        };
        chain.contains = (column: string, value: unknown) => {
          mockDbContains.push({ table, column, value });
          return chain;
        };
        chain.select = () => chain;
        chain.maybeSingle = () => Promise.resolve({
          data: mockOwnershipResults.length > 0
            ? mockOwnershipResults.shift()
            : { id: 'video-1' },
          error: null,
        });
        return chain;
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
    mockDbEquals.length = 0;
    mockDbContains.length = 0;
    mockOwnershipResults.length = 0;
    mockAnalyzeVideo.mockResolvedValue({ metadata: {} });
    mockGetSignedUrl.mockResolvedValue('https://signed.example/video.mp4');
  });

  it('waits for settlement before publishing successful output or a terminal state', async () => {
    const order: string[] = [];
    mockProcessVideo.mockResolvedValue('processed/video-1-story.mp4');

    const outcome = await videoProcessor.process(
      video,
      ['instagram-story'],
      {
        jobId: 'job-1',
        billingPath: 'gateway_tokens',
        beforePublish: async () => {
          order.push('settled');
          expect(
            mockDbUpdates.some(({ table, data }) =>
              table === 'videos'
                && Object.prototype.hasOwnProperty.call(data, 'platform_outputs')),
          ).toBe(false);
        },
      },
    );

    const terminalUpdate = mockDbUpdates.find(({ table, data }) =>
      table === 'videos' && data.status === 'completed');
    if (terminalUpdate) order.push('terminal');

    expect(outcome).toEqual({ successfulOutputs: 1, failedOutputs: 0 });
    expect(order).toEqual(['settled', 'terminal']);
    expect(mockDbEquals.filter(({ table }) => table === 'processing_jobs'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ column: 'id', value: 'job-1' }),
      ]));
    expect(mockDbEquals).not.toContainEqual(expect.objectContaining({
      table: 'processing_jobs',
      column: 'video_id',
    }));
    expect(mockDbUpdates).toContainEqual(expect.objectContaining({
      table: 'processing_jobs',
      data: expect.objectContaining({ status: 'processing_gateway_tokens' }),
    }));
    expect(mockDbContains).toContainEqual({
      table: 'videos',
      column: 'processing_metadata',
      value: { active_job_id: 'job-1' },
    });
  });

  it('waits for the no-charge callback before publishing an all-failed result', async () => {
    const order: string[] = [];
    const settle = jest.fn(async () => { order.push('no-charge-settled'); });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockProcessVideo.mockRejectedValue(new Error('ffmpeg failed'));

    const outcome = await videoProcessor.process(video, ['instagram-story'], {
      jobId: 'job-1',
      billingPath: 'gateway_tokens',
      beforePublish: settle,
    });

    expect(outcome).toEqual({ successfulOutputs: 0, failedOutputs: 1 });
    expect(settle).toHaveBeenCalledWith(outcome);
    expect(mockDbUpdates).toContainEqual(expect.objectContaining({
      table: 'videos',
      data: expect.objectContaining({ status: 'failed' }),
    }));
    order.push('terminal');
    expect(order).toEqual(['no-charge-settled', 'terminal']);
    consoleError.mockRestore();
  });

  it('leaves settlement failure finalization to the durable controller recovery path', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockProcessVideo.mockResolvedValue('processed/video-1-story.mp4');

    await expect(videoProcessor.process(
      video,
      ['instagram-story'],
      {
        jobId: 'job-1',
        billingPath: 'gateway_tokens',
        beforePublish: async () => { throw new Error('settlement failed'); },
      },
    )).rejects.toThrow('settlement failed');

    expect(mockDbUpdates).not.toContainEqual(expect.objectContaining({
      table: 'videos',
      data: expect.objectContaining({ status: 'failed' }),
    }));
    expect(mockDbUpdates).not.toContainEqual(expect.objectContaining({
      table: 'processing_jobs',
      data: expect.objectContaining({ status: 'failed' }),
    }));
    expect(mockDbUpdates.some(({ table, data }) =>
      table === 'videos'
        && Object.prototype.hasOwnProperty.call(data, 'platform_outputs')),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it('rejects publication after recovery has released this job ownership', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockProcessVideo.mockResolvedValue('processed/video-1-story.mp4');
    mockOwnershipResults.push({ id: 'video-1' }, null);

    await expect(videoProcessor.process(video, ['instagram-story'], {
      jobId: 'job-1',
      billingPath: 'gateway_tokens',
      beforePublish: async () => {},
    })).rejects.toThrow('no longer owns this video');

    consoleError.mockRestore();
  });
});
