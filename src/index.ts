import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { apiRouter } from './routes/api.js';
import { voiceRouter } from './routes/voice.js';
import { validateTwilioConfig } from './services/twilio.js';
import { validateRetellConfig } from './services/retell.js';
import { validateDbConnection } from './lib/db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
    },
  },
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});

// Stricter rate limit for verification endpoints
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 attempts per minute
  message: { error: 'Too many verification attempts, please wait a minute.' },
});

app.use('/api', apiLimiter);
app.use('/api/start-verification', verifyLimiter);
app.use('/api/verify-code', verifyLimiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files (frontend)
app.use(express.static(path.join(__dirname, '../public')));

// API routes (SMS consent portal)
app.use('/api', apiRouter);

// Voice routes (Twilio webhooks)
app.use('/voice', voiceRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, async () => {
  console.log(`Dominium CRM running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Validate database connection
  const dbValidation = await validateDbConnection();
  if (dbValidation.connected) {
    console.log('✓ Database connected');
  } else {
    console.error('✗ Database connection failed:', dbValidation.error);
  }

  // Validate Twilio configuration
  const twilioValidation = await validateTwilioConfig();
  if (twilioValidation.valid) {
    console.log('✓ Twilio Verify service validated');
  } else {
    console.error('✗ Twilio configuration error:', twilioValidation.error);
  }

  // Validate Retell configuration
  const retellValidation = validateRetellConfig();
  if (retellValidation.valid) {
    console.log('✓ Retell configuration valid');
  } else {
    console.warn('⚠ Retell not configured:', retellValidation.error);
  }
});

export default app;
