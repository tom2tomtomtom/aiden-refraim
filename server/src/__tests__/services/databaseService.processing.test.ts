const chain = {
  update: jest.fn(),
  eq: jest.fn(),
  neq: jest.fn(),
  in: jest.fn(),
  contains: jest.fn(),
  select: jest.fn(),
  order: jest.fn(),
  limit: jest.fn(),
  maybeSingle: jest.fn(),
  delete: jest.fn(),
};
const mockFrom = jest.fn((_table?: string) => chain);

for (const method of ['update', 'eq', 'neq', 'in', 'contains', 'select', 'order', 'limit', 'delete'] as const) {
  chain[method].mockReturnValue(chain);
}

jest.mock('../../config/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

import { DatabaseService } from '../../services/databaseService';

describe('DatabaseService processing claim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const method of ['update', 'eq', 'neq', 'in', 'contains', 'select', 'order', 'limit', 'delete'] as const) {
      chain[method].mockReturnValue(chain);
    }
  });

  it('atomically claims an idle video and clears outputs from the prior run', async () => {
    chain.maybeSingle.mockResolvedValue({ data: { id: 'video-1' }, error: null });

    await expect(DatabaseService.claimVideoForProcessing('video-1', 'user-1', 'job-1'))
      .resolves.toBe(true);

    expect(mockFrom).toHaveBeenCalledWith('videos');
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'processing',
      platform_outputs: null,
      processing_metadata: {
        active_job_id: 'job-1',
        publication_state: 'active',
      },
      updated_at: expect.any(String),
    }));
    expect(chain.eq).toHaveBeenCalledWith('id', 'video-1');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(chain.neq).toHaveBeenCalledWith('status', 'processing');
    expect(chain.neq).toHaveBeenCalledWith('status', 'PROCESSING');
  });

  it('reports an existing active claim without changing billing state', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(DatabaseService.claimVideoForProcessing('video-1', 'user-1', 'job-1'))
      .resolves.toBe(false);
  });

  it('releases a video only while the same durable job still owns it', async () => {
    chain.maybeSingle.mockResolvedValue({ data: { id: 'video-1' }, error: null });

    await expect(DatabaseService.releaseVideoProcessing(
      'video-1',
      'user-1',
      'job-1',
      { status: 'failed', platform_outputs: null } as any,
    )).resolves.toBe(true);

    expect(chain.contains).toHaveBeenCalledWith(
      'processing_metadata',
      { active_job_id: 'job-1' },
    );
  });

  it('loads the latest durable job for reload and retry recovery', async () => {
    const job = { id: 'job-1', video_id: 'video-1', user_id: 'user-1' };
    chain.maybeSingle.mockResolvedValue({ data: job, error: null });

    await expect(DatabaseService.getLatestProcessingJob('video-1', 'user-1'))
      .resolves.toEqual(job);

    expect(mockFrom).toHaveBeenCalledWith('processing_jobs');
    expect(chain.eq).toHaveBeenCalledWith('video_id', 'video-1');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it('transitions a billing phase only from the expected durable state', async () => {
    const job = { id: 'job-1', status: 'reconciling_gateway_tokens:recovery-1' };
    chain.maybeSingle.mockResolvedValue({ data: job, error: null });

    await expect(DatabaseService.transitionProcessingJob(
      'job-1',
      ['publishing_gateway_tokens'],
      { status: 'reconciling_gateway_tokens:recovery-1' } as any,
    )).resolves.toEqual(job);

    expect(chain.in).toHaveBeenCalledWith('status', ['publishing_gateway_tokens']);
  });

  it('atomically fences publication before reconciliation can compensate', async () => {
    chain.maybeSingle.mockResolvedValue({ data: { id: 'video-1' }, error: null });

    await expect(DatabaseService.fenceVideoPublication('video-1', 'user-1', 'job-1'))
      .resolves.toBe(true);

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'processing',
      processing_metadata: {
        active_job_id: 'job-1',
        publication_state: 'reconciling',
      },
    }));
    expect(chain.contains).toHaveBeenCalledWith('processing_metadata', {
      active_job_id: 'job-1',
      publication_state: 'active',
    });
  });

  it('treats an already-owned reconciliation fence as durable after a crash', async () => {
    chain.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'video-1' }, error: null });

    await expect(DatabaseService.fenceVideoPublication('video-1', 'user-1', 'job-1'))
      .resolves.toBe(true);

    expect(chain.contains).toHaveBeenCalledWith('processing_metadata', {
      active_job_id: 'job-1',
      publication_state: 'reconciling',
    });
  });

  it('deletes a video only when its row is still idle at the final write', async () => {
    chain.maybeSingle.mockResolvedValue({ data: { id: 'video-1' }, error: null });

    await expect(DatabaseService.deleteVideoIfIdle('video-1', 'user-1'))
      .resolves.toBe(true);

    expect(mockFrom).toHaveBeenCalledWith('processing_jobs');
    expect(mockFrom).toHaveBeenCalledWith('videos');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(chain.neq).toHaveBeenCalledWith('status', 'processing');
    expect(chain.neq).toHaveBeenCalledWith('status', 'PROCESSING');
  });
});
