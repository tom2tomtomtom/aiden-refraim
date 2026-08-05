import { Request, Response } from 'express';

jest.mock('../../config/supabase', () => ({ supabase: { from: jest.fn() } }));

jest.mock('../../services/ffmpegService', () => ({
  FFmpegService: { getVideoMetadata: jest.fn() },
}));

jest.mock('../../services/storageService', () => ({
  StorageService: {
    uploadVideo: jest.fn(),
    signVideoRecord: jest.fn((video: unknown) => Promise.resolve(video)),
    getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/src.mp4'),
  },
}));

jest.mock('../../services/databaseService', () => ({
  DatabaseService: {
    createVideo: jest.fn(),
    getVideo: jest.fn(),
    createProcessingJob: jest.fn(),
    claimVideoForProcessing: jest.fn(),
    deleteProcessingJob: jest.fn(),
    getLatestProcessingJob: jest.fn(),
    getProcessingJob: jest.fn(),
  },
}));

jest.mock('../../services/videoProcessingService', () => ({
  processVideoForPlatforms: jest.fn().mockResolvedValue({ successfulOutputs: 1, failedOutputs: 0 }),
}));

jest.mock('../../lib/videoSignature', () => ({
  fileHasVideoSignature: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../lib/quota', () => ({
  getQuotaState: jest.fn(),
  recoverPlanQuotaExport: jest.fn(),
  reserveExportForJob: jest.fn(),
}));

jest.mock('../../lib/gateway-tokens', () => ({
  checkTokens: jest.fn(),
  compensateTokens: jest.fn(),
  deductTokens: jest.fn(),
  recordCostEvent: jest.fn(),
}));

// Lowered so the output-count cap is reachable; the shipped default equals the
// number of supported platforms, so the allow-list alone hides it.
jest.mock('../../config/mediaLimits', () => ({
  ...jest.requireActual('../../config/mediaLimits'),
  MAX_OUTPUTS_PER_EXPORT: 2,
}));

import { uploadVideo, processVideo } from '../../controllers/videoController';
import { FFmpegService } from '../../services/ffmpegService';
import { StorageService } from '../../services/storageService';
import { DatabaseService } from '../../services/databaseService';
import { getQuotaState } from '../../lib/quota';
import { MAX_SOURCE_DURATION_SECONDS } from '../../config/mediaLimits';

const probe = FFmpegService.getVideoMetadata as jest.Mock;

const mockRes = (): Response => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const uploadReq = (): Request => ({
  user: { id: 'user-1' },
  body: { platforms: JSON.stringify(['tiktok']) },
  file: { path: '/tmp/upload-1', originalname: 'clip.mp4', size: 1024, mimetype: 'video/mp4' },
} as any);

const processReq = (platforms: string[]): Request => ({
  user: { id: 'user-1' },
  params: { id: 'video-1' },
  body: { platforms },
} as any);

describe('upload rejects sources whose render cost is unbounded', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (StorageService.getSignedUrl as jest.Mock).mockResolvedValue('https://signed.example/src.mp4');
    (StorageService.signVideoRecord as jest.Mock).mockImplementation((v: unknown) => Promise.resolve(v));
  });

  it('rejects a source longer than the duration cap with 413 and never stores it', async () => {
    probe.mockResolvedValue({
      width: 1920,
      height: 1080,
      duration: MAX_SOURCE_DURATION_SECONDS + 1,
      fps: 30,
    });
    const res = mockRes();

    await uploadVideo(uploadReq(), res);

    expect(res.status).toHaveBeenCalledWith(413);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({ limit: 'duration' });
    expect(StorageService.uploadVideo).not.toHaveBeenCalled();
    expect(DatabaseService.createVideo).not.toHaveBeenCalled();
  });

  it('rejects a source above the pixel cap with 413', async () => {
    probe.mockResolvedValue({ width: 7680, height: 4320, duration: 10, fps: 30 });
    const res = mockRes();

    await uploadVideo(uploadReq(), res);

    expect(res.status).toHaveBeenCalledWith(413);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({ limit: 'resolution' });
    expect(StorageService.uploadVideo).not.toHaveBeenCalled();
  });

  it('rejects an unmeasurable source rather than letting it through uncapped', async () => {
    probe.mockResolvedValue({ width: 1920, height: 1080, duration: NaN, fps: 30 });
    const res = mockRes();

    await uploadVideo(uploadReq(), res);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(StorageService.uploadVideo).not.toHaveBeenCalled();
  });

  it('accepts a source inside both caps and reports what it measured', async () => {
    probe.mockResolvedValue({ width: 1920, height: 1080, duration: 12.5, fps: 30 });
    (StorageService.uploadVideo as jest.Mock).mockResolvedValue('videos/clip.mp4');
    (DatabaseService.createVideo as jest.Mock).mockResolvedValue({ id: 'video-1' });
    const res = mockRes();

    await uploadVideo(uploadReq(), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({
      source: { durationSeconds: 12.5, width: 1920, height: 1080 },
    });
  });
});

describe('export rejects unbounded work before it costs the caller anything', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (StorageService.getSignedUrl as jest.Mock).mockResolvedValue('https://signed.example/src.mp4');
    (DatabaseService.getVideo as jest.Mock).mockResolvedValue({
      id: 'video-1',
      user_id: 'user-1',
      original_url: 'videos/clip.mp4',
      status: 'UPLOADED',
    });
  });

  it('rejects an over-long source with 413 without resolving a billing path', async () => {
    probe.mockResolvedValue({
      width: 1920,
      height: 1080,
      duration: MAX_SOURCE_DURATION_SECONDS + 1,
      fps: 30,
    });
    const res = mockRes();

    await processVideo(processReq(['tiktok']), res);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(getQuotaState).not.toHaveBeenCalled();
    expect(DatabaseService.createProcessingJob).not.toHaveBeenCalled();
    expect(DatabaseService.claimVideoForProcessing).not.toHaveBeenCalled();
  });

  it('rejects more outputs than one export may fan out to', async () => {
    probe.mockResolvedValue({ width: 1920, height: 1080, duration: 10, fps: 30 });
    const res = mockRes();

    await processVideo(processReq(['tiktok', 'youtube-shorts', 'instagram-story']), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({ requested: 3, allowed: 2 });
    expect(getQuotaState).not.toHaveBeenCalled();
  });

  it('falls through to the pipeline when the source cannot be probed', async () => {
    probe.mockRejectedValue(new Error('ffprobe could not read the remote source'));
    (getQuotaState as jest.Mock).mockResolvedValue({
      plan: 'free', used: 0, limit: 3, remaining: 3,
    });
    (DatabaseService.createProcessingJob as jest.Mock).mockResolvedValue({ id: 'job-1' });
    // Stop at the claim so the assertion is about the cap, not about billing.
    (DatabaseService.claimVideoForProcessing as jest.Mock).mockResolvedValue(false);
    (DatabaseService.getLatestProcessingJob as jest.Mock).mockResolvedValue(null);
    const res = mockRes();

    await processVideo(processReq(['tiktok']), res);

    expect(res.status).not.toHaveBeenCalledWith(413);
    expect(getQuotaState).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });
});
