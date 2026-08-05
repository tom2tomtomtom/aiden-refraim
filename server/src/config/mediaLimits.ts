const positiveNumberFromEnv = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * The 100 MB upload cap bounds bytes, not work: an efficiently encoded file
 * fits hours of video into it, and every second is then re-encoded once per
 * requested platform. These bound the work itself.
 */
export const MAX_SOURCE_DURATION_SECONDS = positiveNumberFromEnv(
  'REFRAIM_MAX_SOURCE_DURATION_SECONDS',
  600,
);
export const MAX_SOURCE_PIXELS = positiveNumberFromEnv(
  'REFRAIM_MAX_SOURCE_PIXELS',
  3840 * 2160,
);
export const MAX_OUTPUTS_PER_EXPORT = positiveNumberFromEnv(
  'REFRAIM_MAX_OUTPUTS_PER_EXPORT',
  8,
);

/** What one export costs us, in the two dimensions that actually scale. */
export interface SourceMeasurements {
  durationSeconds: number;
  width: number;
  height: number;
}

export interface LimitViolation {
  limit: 'duration' | 'resolution';
  message: string;
  measured: number;
  allowed: number;
}

export const findSourceLimitViolation = (
  source: SourceMeasurements,
): LimitViolation | null => {
  const { durationSeconds, width, height } = source;

  // An unreadable duration is not evidence of a short video. Treat it as a
  // rejection rather than an exemption from the cap.
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return {
      limit: 'duration',
      message: 'We could not read this video\'s duration. Please re-export it and try again.',
      measured: 0,
      allowed: MAX_SOURCE_DURATION_SECONDS,
    };
  }

  if (durationSeconds > MAX_SOURCE_DURATION_SECONDS) {
    return {
      limit: 'duration',
      message: `This video is ${Math.round(durationSeconds)}s long. The longest we can reframe is ${MAX_SOURCE_DURATION_SECONDS}s — please trim it and try again.`,
      measured: Math.round(durationSeconds),
      allowed: MAX_SOURCE_DURATION_SECONDS,
    };
  }

  const pixels = width * height;
  if (!Number.isFinite(pixels) || pixels <= 0) {
    return {
      limit: 'resolution',
      message: 'We could not read this video\'s dimensions. Please re-export it and try again.',
      measured: 0,
      allowed: MAX_SOURCE_PIXELS,
    };
  }

  if (pixels > MAX_SOURCE_PIXELS) {
    return {
      limit: 'resolution',
      message: `This video is ${width}x${height}. The largest we can reframe is ${MAX_SOURCE_PIXELS.toLocaleString('en-US')} pixels per frame — please downscale it and try again.`,
      measured: pixels,
      allowed: MAX_SOURCE_PIXELS,
    };
  }

  return null;
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
