// Must be the first import in server.ts. Sentry 10 uses OpenTelemetry
// which monkey-patches Express and HTTP at require time, so init must
// run before those modules are loaded.
import { config } from 'dotenv';
config();

import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const dsn = process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.RAILWAY_GIT_COMMIT_SHA,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0.1),
    integrations: [nodeProfilingIntegration()],
  });
  console.log('[SENTRY] Error monitoring enabled', {
    environment: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV,
  });
} else {
  console.log('[SENTRY] Disabled (no DSN configured)');
}
