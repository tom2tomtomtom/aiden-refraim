// Load environment variables first
import { config } from 'dotenv';
config();

// Then import the rest
import app from './app';
import { InitializationService } from './services/initializationService';

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
