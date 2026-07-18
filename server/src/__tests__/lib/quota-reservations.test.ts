const mockRpc = jest.fn();

jest.mock('../../config/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import {
  recoverPlanQuotaExport,
  reserveExportForJob,
} from '../../lib/quota';

describe('durable plan quota reservations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the durable job id as the atomic reservation idempotency key', async () => {
    mockRpc.mockResolvedValue({
      data: { reserved: true, used: 2 },
      error: null,
    });

    const result = await reserveExportForJob(
      'user-1',
      'job-1',
      { plan: 'free', used: 1, limit: 3, remaining: 2, resetsAt: '2026-08-01' },
    );

    expect(mockRpc).toHaveBeenCalledWith('reserve_refraim_export', {
      p_job_id: 'job-1',
      p_user_id: 'user-1',
      p_limit: 3,
    });
    expect(result).toEqual(expect.objectContaining({
      used: 2,
      remaining: 1,
    }));
  });

  it('uses one atomic recovery call for allowance refund, job finalization, and video release', async () => {
    mockRpc.mockResolvedValue({
      data: { recovered: true, refunded: true },
      error: null,
    });

    await expect(recoverPlanQuotaExport(
      'user-1',
      'video-1',
      'job-1',
      true,
    )).resolves.toEqual({ recovered: true, refunded: true });

    expect(mockRpc).toHaveBeenCalledWith('recover_refraim_plan_quota_export', {
      p_user_id: 'user-1',
      p_video_id: 'video-1',
      p_job_id: 'job-1',
      p_legacy_missing_job: true,
    });
  });
});
