const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const { verifyConnection } = require('./utils/db');
const logger = require('./utils/logger');
const schedulerService = require('./services/scheduler');

// Import routes
const profilesRouter = require('./routes/profiles');
const eventsRouter = require('./routes/events');
const billingRouter = require('./routes/billing');
const webhookRouter = require('./routes/webhook');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());

// Body parsing middleware
// Note: webhook route needs raw body, so we apply express.json() selectively
app.use('/razorpay/webhook', webhookRouter); // This route uses express.raw()
app.use(express.json()); // For all other routes

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'linkedin-signal-monitor-api'
  });
});

// API info endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'LinkedIn Signal Monitor API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      profiles: {
        'POST /profiles': 'Create a new profile to monitor',
        'GET /profiles': 'Get all your profiles',
        'PATCH /profiles/:id': 'Update profile keywords',
        'DELETE /profiles/:id': 'Delete a profile'
      },
      events: {
        'GET /events': 'Get detected keyword events',
        'GET /events/stats': 'Get event statistics'
      },
      billing: {
        'POST /billing/create-subscription': 'Create Razorpay subscription',
        'POST /webhook': 'Configure webhook URL',
        'DELETE /webhook': 'Remove webhook URL'
      },
      utility: {
        'POST /scan-now': 'Manually trigger profile scan (testing)',
        'GET /health': 'Health check'
      }
    },
    authentication: 'Use Authorization: Bearer YOUR_API_KEY header'
  });
});

// Mount routes
app.use('/profiles', profilesRouter);
app.use('/events', eventsRouter);
app.use('/billing', billingRouter); // Billing endpoints including create-subscription
app.use('/webhook', billingRouter); // Webhook config (legacy path for backward compatibility)
// Note: /razorpay/webhook is already mounted above

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Startup sequence
async function startServer() {
  try {
    logger.info('Starting LinkedIn Signal Monitor API...');

    // Verify environment variables
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_KEY',
      'APIFY_TOKEN',
      'APIFY_ACTOR_ID',
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
      'RAZORPAY_BASIC_PLAN_ID',
      'RAZORPAY_BUSINESS_PLAN_ID'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      logger.error('Missing required environment variables', { missingVars });
      process.exit(1);
    }

    // Verify database connection
    const dbConnected = await verifyConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database. Exiting...');
      process.exit(1);
    }

    // Start scheduler
    schedulerService.start();

    // Start HTTP server
    app.listen(PORT, () => {
      logger.info(`✅ Server running on port ${PORT}`);
      logger.info(`📡 API available at http://localhost:${PORT}`);
      logger.info(`🔄 Scheduler running - scans every hour`);
    });

  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  schedulerService.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  schedulerService.stop();
  process.exit(0);
});

// Start the server
startServer();
