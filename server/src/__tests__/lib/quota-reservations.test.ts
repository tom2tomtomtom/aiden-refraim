const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockMaybeSingle = jest.fn();
const mockUpdate = jest.fn();
const mockSingle = jest.fn();

const billingChain = {
  select: mockSelect,
  eq: mockEq,
  maybeSingle: mockMaybeSingle,
  update: mockUpdate,
  single: mockSingle,
};

for (const method of [mockSelect, mockEq, mockUpdate]) {
  method.mockReturnValue(billingChain);
}

jest.mock('../../config/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  getQuotaState,
  recoverPlanQuotaExport,
  reserveExportForJob,
} from '../../lib/quota';

describe('durable plan quota reservations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(billingChain);
    for (const method of [mockSelect, mockEq, mockUpdate]) {
      method.mockReturnValue(billingChain);
    }
  });

  it('reports a stale period as unused without mutating billing outside the reservation RPC', async () => {
    const staleReset = '2026-05-01T00:00:00.000Z';
    mockMaybeSingle.mockResolvedValue({
      data: {
        user_id: 'user-1',
        stripe_price_id: null,
        exports_this_month: 3,
        exports_reset_at: staleReset,
      },
      error: null,
    });
    mockSingle.mockResolvedValue({
      data: {
        user_id: 'user-1',
        stripe_price_id: null,
        exports_this_month: 0,
        exports_reset_at: '2026-07-18T00:00:00.000Z',
      },
      error: null,
    });

    const result = await getQuotaState('user-1');

    expect(result.used).toBe(0);
    expect(result.remaining).toBe(3);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('uses the durable job id as the atomic reservation idempotency key', async () => {
    mockRpc.mockResolvedValue({
      data: {
        reserved: true,
        used: 2,
        resets_at: '2026-07-18T13:00:00.000Z',
      },
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
      resetsAt: '2026-07-18T13:00:00.000Z',
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

  it('packages schema-local, invoker-only RPCs with atomic period rollover', () => {
    const migration = readFileSync(resolve(
      __dirname,
      '../../../supabase/migrations/20260718130500_crash_safe_refraim_quota.sql',
    ), 'utf8');
    const config = readFileSync(resolve(__dirname, '../../../supabase/config.toml'), 'utf8');

    expect(config).toMatch(/schemas\s*=\s*\[[^\]]*"refraim"[^\]]*\]/);
    expect(config).toMatch(/major_version\s*=\s*17/);
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS refraim.export_quota_reservations');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION refraim.reserve_refraim_export');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION refraim.recover_refraim_plan_quota_export');
    expect(migration.match(/SECURITY INVOKER/g)).toHaveLength(2);
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(2);
    expect(migration).not.toMatch(/public\.(processing_jobs|user_billing|videos)/);
    expect(migration).toMatch(/exports_reset_at[\s\S]*FOR UPDATE[\s\S]*INTERVAL '30 days'/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION refraim\.reserve_refraim_export[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION refraim\.recover_refraim_plan_quota_export[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/has_function_privilege\(\s*'anon'/);
    expect(migration).toMatch(/has_function_privilege\(\s*'authenticated'/);
    expect(migration).toMatch(/has_function_privilege\(\s*'service_role'/);
  });
});
