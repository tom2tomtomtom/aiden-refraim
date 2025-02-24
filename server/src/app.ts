import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { json, urlencoded } from 'body-parser';
import testRoutes from './routes/test';
import videoRoutes from './routes/videos';
import adminRoutes from './routes/admin';

const app = express();

// Middleware
app.use(morgan('dev'));

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'development' ? 'http://localhost:5173' : process.env.CLIENT_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 600 // Cache preflight requests for 10 minutes
}));

// Log all requests
app.use((req, res, next) => {
  console.log('Incoming request:', {
    method: req.method,
    path: req.path,
    headers: {
      'content-type': req.headers['content-type'],
      'authorization': req.headers.authorization ? 'present' : 'missing'
    }
  });
  next();
});

// Body parsing middleware with increased limits
app.use(json({ limit: '500mb' }));
app.use(urlencoded({ extended: true, limit: '500mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log('Request completed:', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      userAgent: req.headers['user-agent']
    });
  });
  next();
});

// Routes
app.use('/api/test', testRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/admin', adminRoutes);

// Error handling with detailed logging
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const errorDetails = {
    message: err.message,
    stack: err.stack,
    type: err.name,
    path: req.path,
    method: req.method,
    userId: (req as any).user?.id,
    body: req.body,
    query: req.query,
    file: req.file
  };
  
  console.error('Application error:', errorDetails);
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    code: err.code,
    type: err.name
  });
});

export default app;
