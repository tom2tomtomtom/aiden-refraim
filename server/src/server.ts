// IMPORTANT: ./instrument must be first — Sentry 10 / OpenTelemetry
// instruments Express and HTTP at require time, so it must run before
// those modules are loaded. It also loads dotenv on our behalf.
import './instrument';

// Then import the rest
import app from './app';
import { InitializationService } from './services/initializationService';
import { validateSupabaseEnvOrExit } from './lib/supabase-env';

// Fail loud at startup if SUPABASE_URL is missing or points at the wrong
// project. Must run before any Supabase client is constructed.
validateSupabaseEnvOrExit();

const port = process.env.PORT || 3000;

async function startServer() {
  try {
    // Skip DB initialization in production (schema managed by Supabase migrations)
    if (process.env.NODE_ENV !== 'production') {
      await InitializationService.initialize();
    } else {
      console.log('Production mode: skipping DB initialization (managed by Supabase migrations)');
    }

    // Start the server
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Build trigger 1776036987
