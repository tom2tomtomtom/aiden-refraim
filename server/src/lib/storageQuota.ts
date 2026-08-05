/**
 * Per-user cap on stored source bytes.
 *
 * The 100 MB multer limit bounds one request, not one account. Repeat it and
 * the private bucket grows without limit at our cost, holding material we are
 * obliged to keep. Exports are already gated by tokens and plan quota; upload
 * was the one unbounded, unpriced way in.
 */

import { supabase } from '../config/supabase';

const positiveNumberFromEnv = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const MAX_STORAGE_BYTES_PER_USER = positiveNumberFromEnv(
  'REFRAIM_MAX_STORAGE_BYTES_PER_USER',
  5 * 1024 * 1024 * 1024,
);

export interface StorageQuotaVerdict {
  allowed: boolean;
  usedBytes: number;
  limitBytes: number;
  incomingBytes: number;
}

function formatGigabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function storageQuotaMessage(verdict: StorageQuotaVerdict): string {
  return `You have used ${formatGigabytes(verdict.usedBytes)} of your ${formatGigabytes(verdict.limitBytes)} of storage, and this file needs ${formatGigabytes(verdict.incomingBytes)}. Delete a video and try again.`;
}

/**
 * Decide whether one more upload fits.
 *
 * Fails closed. A quota we cannot read is not evidence of room, and the whole
 * point is to stop unbounded growth we would only notice on the bill.
 */
export async function checkStorageQuota(
  userId: string,
  incomingBytes: number,
): Promise<StorageQuotaVerdict> {
  const denied: StorageQuotaVerdict = {
    allowed: false,
    usedBytes: MAX_STORAGE_BYTES_PER_USER,
    limitBytes: MAX_STORAGE_BYTES_PER_USER,
    incomingBytes,
  };

  try {
    const { data, error } = await supabase.rpc('user_storage_bytes', { p_user_id: userId });

    if (error) {
      console.error('[storage-quota] Could not read usage:', error);
      return denied;
    }

    const usedBytes = Number(data ?? 0);
    const safeUsed = Number.isFinite(usedBytes) && usedBytes > 0 ? usedBytes : 0;

    return {
      allowed: safeUsed + incomingBytes <= MAX_STORAGE_BYTES_PER_USER,
      usedBytes: safeUsed,
      limitBytes: MAX_STORAGE_BYTES_PER_USER,
      incomingBytes,
    };
  } catch (err) {
    console.error('[storage-quota] Usage read threw:', err);
    return denied;
  }
}
