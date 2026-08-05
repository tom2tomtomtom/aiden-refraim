const mockRpc = jest.fn();

jest.mock('../../config/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import {
  MAX_STORAGE_BYTES_PER_USER,
  checkStorageQuota,
  storageQuotaMessage,
} from '../../lib/storageQuota';

const GB = 1024 * 1024 * 1024;

describe('per-user storage quota', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sums usage in the database rather than reading every row', async () => {
    mockRpc.mockResolvedValue({ data: 1 * GB, error: null });

    await checkStorageQuota('user-1', 10 * 1024 * 1024);

    expect(mockRpc).toHaveBeenCalledWith('user_storage_bytes', { p_user_id: 'user-1' });
  });

  it('allows an upload that fits', async () => {
    mockRpc.mockResolvedValue({ data: 1 * GB, error: null });

    const verdict = await checkStorageQuota('user-1', 100 * 1024 * 1024);

    expect(verdict.allowed).toBe(true);
    expect(verdict.usedBytes).toBe(1 * GB);
  });

  it('refuses the upload that would cross the line, not the one after it', async () => {
    mockRpc.mockResolvedValue({ data: MAX_STORAGE_BYTES_PER_USER - 1, error: null });

    await expect(checkStorageQuota('user-1', 1)).resolves.toMatchObject({ allowed: true });
    await expect(checkStorageQuota('user-1', 2)).resolves.toMatchObject({ allowed: false });
  });

  it('fails closed when usage cannot be read', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'connection lost' } });

    const verdict = await checkStorageQuota('user-1', 1);

    // An unreadable quota is not evidence of room. Growth we only notice on
    // the bill is exactly what this exists to prevent.
    expect(verdict.allowed).toBe(false);
  });

  it('treats rows predating the column as zero rather than blocking', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const verdict = await checkStorageQuota('user-1', 100 * 1024 * 1024);

    expect(verdict.allowed).toBe(true);
    expect(verdict.usedBytes).toBe(0);
  });

  it('tells the user what to do about it', async () => {
    mockRpc.mockResolvedValue({ data: 5 * GB, error: null });

    const verdict = await checkStorageQuota('user-1', 100 * 1024 * 1024);
    const message = storageQuotaMessage(verdict);

    expect(verdict.allowed).toBe(false);
    expect(message).toContain('5.0 GB');
    expect(message).toContain('Delete a video');
  });
});
