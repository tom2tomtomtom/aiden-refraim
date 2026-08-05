const mockRpc = jest.fn();

jest.mock('../../config/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import {
  MAX_CONCURRENT_EXPORTS_PER_USER,
  checkExportConcurrency,
} from '../../lib/exportConcurrency';
import { LEGACY_STALE_MS } from '../../lib/exportLease';

describe('cross-video export concurrency cap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('asks the database for a count rather than listing jobs', async () => {
    mockRpc.mockResolvedValue({ data: 0, error: null });

    await checkExportConcurrency('user-1');

    expect(mockRpc).toHaveBeenCalledWith('count_active_refraim_exports', {
      p_user_id: 'user-1',
      // Same staleness rule the reaper uses, so a job it would reap does not
      // hold a slot the user can never get back.
      p_legacy_stale_seconds: Math.floor(LEGACY_STALE_MS / 1000),
    });
  });

  it('allows an export up to the cap and refuses the one past it', async () => {
    mockRpc.mockResolvedValue({ data: MAX_CONCURRENT_EXPORTS_PER_USER - 1, error: null });
    await expect(checkExportConcurrency('user-1')).resolves.toMatchObject({ allowed: true });

    mockRpc.mockResolvedValue({ data: MAX_CONCURRENT_EXPORTS_PER_USER, error: null });
    await expect(checkExportConcurrency('user-1')).resolves.toMatchObject({
      allowed: false,
      active: MAX_CONCURRENT_EXPORTS_PER_USER,
    });
  });

  it('fails open when the count cannot be read', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'connection lost' } });

    // This bounds contention between users. Refusing a paid export because one
    // read failed is worse than briefly exceeding the cap, and every cost gate
    // downstream still applies.
    await expect(checkExportConcurrency('user-1')).resolves.toMatchObject({ allowed: true });
  });

  it('fails open when the count throws', async () => {
    mockRpc.mockRejectedValue(new Error('socket hang up'));

    await expect(checkExportConcurrency('user-1')).resolves.toMatchObject({ allowed: true });
  });
});
