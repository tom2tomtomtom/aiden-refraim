const positiveNumberFromEnv = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const PROBE_TIMEOUT_MS = positiveNumberFromEnv('REFRAIM_PROBE_TIMEOUT_MS', 60_000);
export const MIN_RENDER_TIMEOUT_MS = positiveNumberFromEnv('REFRAIM_MIN_RENDER_TIMEOUT_MS', 120_000);
export const MAX_RENDER_TIMEOUT_MS = positiveNumberFromEnv('REFRAIM_MAX_RENDER_TIMEOUT_MS', 3_600_000);
export const RENDER_REALTIME_FACTOR = positiveNumberFromEnv('REFRAIM_RENDER_REALTIME_FACTOR', 10);

/**
 * `libx264 -preset medium` runs at roughly source-realtime on a shared vCPU,
 * so a fixed ceiling either kills long legitimate renders or fails to bound
 * short pathological ones. Derive it from the measured source duration and
 * fall back to the outer ceiling when the duration is unknown.
 */
export const renderTimeoutMs = (durationSeconds?: number): number => {
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return MAX_RENDER_TIMEOUT_MS;
  }

  const derived = durationSeconds * RENDER_REALTIME_FACTOR * 1000;
  return Math.min(MAX_RENDER_TIMEOUT_MS, Math.max(MIN_RENDER_TIMEOUT_MS, derived));
};
