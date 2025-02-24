import app from './app';
import { initializeDatabase } from './config/database';

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Initialize database
    console.log('Initializing database...');
    await initializeDatabase();

    // Start server
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
