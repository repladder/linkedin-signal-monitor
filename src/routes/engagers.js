const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const engagersService = require('../services/engagers');
const { v4: uuidv4 } = require('uuid');

// In-memory storage for temporary scan results (cleared after 1 hour)
const scanResults = new Map();

// Cleanup old scans every hour
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [scanId, data] of scanResults.entries()) {
    if (data.timestamp < oneHourAgo) {
      scanResults.delete(scanId);
      logger.info('Cleaned up old scan', { scanId });
    }
  }
}, 60 * 60 * 1000);

// POST /engagers/scan - Start a new engager scan
router.post(
  '/scan',
  authenticateToken,
  [
    body('post_url').trim().notEmpty().withMessage('Post URL is required'),
    body('post_url').matches(/linkedin\.com\/posts\//).withMessage('Must be a valid LinkedIn post URL'),
    body('engagement_types').isArray({ min: 1 }).withMessage('At least one engagement type required'),
    body('limit_per_type').isInt({ min: 1, max: 500 }).withMessage('Limit must be between 1 and 500')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    try {
      const { post_url, engagement_types, limit_per_type } = req.body;
      const scanId = uuidv4();

      logger.info('Starting engager scan', {
        scanId,
        userId: req.user.id,
        postUrl: post_url,
        engagementTypes: engagement_types,
        limit: limit_per_type
      });

      // Initialize scan status
      scanResults.set(scanId, {
        status: 'processing',
        progress: {
          reactions_scraped: 0,
          comments_scraped: 0,
          profiles_enriched: 0,
          total: 0
        },
        timestamp: Date.now()
      });

      // Send immediate response with scan ID
      res.status(202).json({
        success: true,
        message: 'Scan started',
        scan_id: scanId
      });

      // Process scan in background
      setImmediate(async () => {
        try {
          // Scan engagers
          const result = await engagersService.scanPostEngagers(
            post_url,
            engagement_types,
            limit_per_type,
            (progress) => {
              // Update progress
              const scanData = scanResults.get(scanId);
              if (scanData) {
                scanData.progress = progress;
              }
            }
          );

          // Store results
          scanResults.set(scanId, {
            status: 'completed',
            post_url,
            engagement_types,
            total_engagers: result.engagers.length,
            unique_profiles: result.uniqueProfiles,
            engagers: result.engagers,
            csv_data: result.csv,
            timestamp: Date.now()
          });

          logger.info('Engager scan completed', {
            scanId,
            totalEngagers: result.engagers.length,
            uniqueProfiles: result.uniqueProfiles
          });

        } catch (error) {
          logger.error('Engager scan failed', {
            scanId,
            error: error.message,
            stack: error.stack
          });

          scanResults.set(scanId, {
            status: 'failed',
            error: error.message,
            timestamp: Date.now()
          });
        }
      });

    } catch (error) {
      logger.error('Error starting engager scan:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to start scan'
      });
    }
  }
);

// GET /engagers/scan/:id/status - Get scan status and progress
router.get('/scan/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const scanData = scanResults.get(id);

    if (!scanData) {
      return res.status(404).json({
        success: false,
        error: 'Scan not found or expired'
      });
    }

    res.json({
      success: true,
      scan_id: id,
      status: scanData.status,
      progress: scanData.progress,
      ...(scanData.status === 'completed' && {
        total_engagers: scanData.total_engagers,
        unique_profiles: scanData.unique_profiles
      }),
      ...(scanData.status === 'failed' && {
        error: scanData.error
      })
    });

  } catch (error) {
    logger.error('Error fetching scan status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch scan status'
    });
  }
});

// GET /engagers/scan/:id/results - Get scan results (for display in UI)
router.get('/scan/:id/results', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const scanData = scanResults.get(id);

    if (!scanData) {
      return res.status(404).json({
        success: false,
        error: 'Scan not found or expired'
      });
    }

    if (scanData.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: `Scan is ${scanData.status}. Results not available yet.`
      });
    }

    res.json({
      success: true,
      scan_id: id,
      post_url: scanData.post_url,
      engagement_types: scanData.engagement_types,
      total_engagers: scanData.total_engagers,
      unique_profiles: scanData.unique_profiles,
      engagers: scanData.engagers
    });

  } catch (error) {
    logger.error('Error fetching scan results:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch results'
    });
  }
});

// GET /engagers/scan/:id/download - Download CSV
router.get('/scan/:id/download', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const scanData = scanResults.get(id);

    if (!scanData) {
      return res.status(404).json({
        success: false,
        error: 'Scan not found or expired'
      });
    }

    if (scanData.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: `Scan is ${scanData.status}. CSV not available yet.`
      });
    }

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="linkedin-engagers-${id}.csv"`);
    res.send(scanData.csv_data);

    logger.info('CSV downloaded', { scanId: id, userId: req.user.id });

  } catch (error) {
    logger.error('Error downloading CSV:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download CSV'
    });
  }
});

// GET /engagers/scans - List recent scans (from current session)
router.get('/scans', authenticateToken, async (req, res) => {
  try {
    // Get all scans from memory (last hour)
    const scans = Array.from(scanResults.entries())
      .map(([id, data]) => ({
        scan_id: id,
        post_url: data.post_url || null,
        status: data.status,
        total_engagers: data.total_engagers || 0,
        unique_profiles: data.unique_profiles || 0,
        timestamp: data.timestamp
      }))
      .sort((a, b) => b.timestamp - a.timestamp);

    res.json({
      success: true,
      scans
    });

  } catch (error) {
    logger.error('Error fetching scans:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch scans'
    });
  }
});

module.exports = router;
