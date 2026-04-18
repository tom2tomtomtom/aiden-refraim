import express from 'express';
import * as Sentry from '@sentry/node';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { json, urlencoded } from 'body-parser';
import rateLimit from 'express-rate-limit';
import testRoutes from './routes/test';
import videoRoutes from './routes/videoRoutes';
import adminRoutes from './routes/admin';
import focusPointRoutes from './routes/focusPointRoutes';
import scanRoutes from './routes/scanRoutes';
import billingRoutes from './routes/billingRoutes';
import webhookRoutes from './routes/webhookRoutes';
import aiEditorRoutes from './routes/aiEditorRoutes';

const app = express();

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // stricter for auth
  message: { error: 'Too many auth attempts' },
});

// Middleware
app.use(morgan('dev'));

// CORS configuration
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5180',
    'https://refraim-app.netlify.app',
    'https://refraim.aiden.services',
    process.env.CLIENT_URL || '',
  ].filter(Boolean),
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

// Webhook routes (must be before json body parser for raw body access)
app.use('/api/webhooks', webhookRoutes);

// Body parsing middleware with increased limits
app.use(json({ limit: '5mb' }));
app.use(urlencoded({ extended: true, limit: '5mb' }));

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

// Health check (no auth required)
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// Rate limiting
app.use('/api', apiLimiter);
app.use('/api/billing/checkout', authLimiter);

// Routes
app.use('/api/test', testRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/videos', focusPointRoutes);
app.use('/api/videos', scanRoutes);
app.use('/api/videos', aiEditorRoutes);
app.use('/api/billing', billingRoutes);

// Serve client static files (built by Vite)
const clientDistPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDistPath));

// SPA catch-all: serve index.html for any non-API route
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// Sentry must see errors before our own handler swallows them. It's a
// no-op if Sentry.init was never called (missing DSN).
Sentry.setupExpressErrorHandler(app);

// Error handling with detailed logging
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const errorDetails = {
    message: err.message,
    stack: err.stack,
    type: err.name,
    path: req.path,
    method: req.method,
    userId: (req as any).user?.id,
    // Don't log raw req.body — it can contain auth tokens, file buffers, or PII.
    bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : undefined,
    query: req.query,
    fileMeta: req.file
      ? { name: req.file.originalname, size: req.file.size, mime: req.file.mimetype }
      : undefined,
  };

  console.error('Application error:', errorDetails);

  // In production don't leak stack traces or internal error messages to the client.
  const isProd = process.env.NODE_ENV === 'production';
  const status = err.status || 500;
  res.status(status).json({
    error: isProd && status >= 500 ? 'Internal server error' : (err.message || 'Internal server error'),
    code: err.code,
    type: err.name,
  });
});

export default app;
