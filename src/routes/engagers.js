const express = require('express');
const router = express.Router();
const { authenticateApiKey } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const engagersService = require('../services/engagers');
const { v4: uuidv4 } = require('uuid');

/**
 * Safely convert any value to a string for frontend display
 */
function safeStringify(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    if (value.name && typeof value.name === 'string') {
      return value.name;
    }
    if (value.title && typeof value.title === 'string') {
      return value.title;
    }
    return '';
  }
  return String(value);
}

/**
 * Flatten engager data to prevent React rendering errors
 */
function flattenEngagerData(engager) {
  return {
    scan_id: engager.scan_id || '',
    linkedin_url: safeStringify(engager.linkedin_url),
    name: safeStringify(engager.name),
    job_title: safeStringify(engager.job_title || engager.headline),
    company_name: safeStringify(engager.company_name || engager.company),
    company_profile_url: safeStringify(engager.company_profile_url),
    industry: safeStringify(engager.industry),
    employee_size: safeStringify(engager.employee_size),
    company_location: safeStringify(engager.company_location || engager.location),
    location: safeStringify(engager.location),
    reaction_type: safeStringify(engager.reaction_type),
    comment_text: safeStringify(engager.comment_text),
    created_at: engager.created_at || new Date().toISOString()
  };
}

// POST /engagers/scan - Start a new engager scan
router.post(
  '/scan',
  authenticateApiKey,
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
      const userId = req.user.id;
      const scanId = uuidv4();

      logger.info('Starting engager scan', {
        scanId,
        userId,
        postUrl: post_url,
        engagementTypes: engagement_types,
        limit: limit_per_type
      });

      // Create initial scan record in Supabase
      const { supabase } = require('../config/supabase');
      const { error: insertError } = await supabase.from('engager_scans').insert({
        id: scanId,
        user_id: userId,
        post_url: post_url,
        status: 'processing',
        engagement_types: engagement_types,
        limit_per_type: limit_per_type || 10
      });

      if (insertError) {
        logger.error('Failed to create scan record', { error: insertError });
        return res.status(500).json({ success: false, error: 'Failed to create scan record' });
      }

      // Send immediate response with scan ID
      res.status(202).json({
        success: true,
        message: 'Scan started',
        scan_id: scanId
      });

      // Process scan in background
      setImmediate(async () => {
        try {
          const onProgress = async (progress) => {
            await supabase.from('engager_scans').update({
              total_engagers: progress.total || 0,
              profiles_enriched: progress.profiles_enriched || 0,
              companies_enriched: progress.companies_enriched || 0
            }).eq('id', scanId);
          };

          const result = await engagersService.scanPostEngagers(
            post_url,
            engagement_types,
            limit_per_type,
            onProgress
          );

          // Save complete results to Supabase
          await engagersService.saveToSupabase(userId, scanId, {
            postUrl: post_url,
            engagementTypes: engagement_types,
            limitPerType: limit_per_type || 10
          }, result);

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

          const { supabase } = require('../config/supabase');
          await supabase.from('engager_scans').update({
            status: 'failed',
            error_message: error.message
          }).eq('id', scanId);
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
router.get('/scan/:id/status', authenticateApiKey, async (req, res) => {
  try {
    const { id: scanId } = req.params;
    const userId = req.user.id;

    const { supabase } = require('../config/supabase');
    const { data: scan, error } = await supabase
      .from('engager_scans')
      .select('id, status, total_engagers, profiles_enriched, companies_enriched, error_message')
      .eq('id', scanId)
      .eq('user_id', userId)
      .single();

    if (error || !scan) {
      return res.status(404).json({ success: false, error: 'Scan not found' });
    }

    res.json({
      success: true,
      scan_id: scanId,
      status: scan.status,
      progress: {
        total: scan.total_engagers || 0,
        profiles_enriched: scan.profiles_enriched || 0,
        companies_enriched: scan.companies_enriched || 0
      },
      ...(scan.status === 'failed' && { error: scan.error_message })
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
router.get('/scan/:id/results', authenticateApiKey, async (req, res) => {
  try {
    const { id: scanId } = req.params;
    const userId = req.user.id;

    const result = await engagersService.getFromSupabase(userId, scanId);
    const flattenedEngagers = result.engagers.map(flattenEngagerData);

    res.json({
      success: true,
      scan_id: result.scan_id,
      post_url: result.post_url,
      status: result.status,
      total_engagers: result.total_engagers,
      unique_profiles: result.unique_profiles,
      profiles_enriched: result.profiles_enriched,
      companies_enriched: result.companies_enriched,
      engagers: flattenedEngagers
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
router.get('/scan/:id/download', authenticateApiKey, async (req, res) => {
  try {
    const { id: scanId } = req.params;
    const userId = req.user.id;

    const result = await engagersService.getFromSupabase(userId, scanId);

    if (result.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: `Scan is ${result.status}. CSV not available yet.`
      });
    }

    const csv = engagersService._generateCSV(result.engagers);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="linkedin-engagers-${scanId}.csv"`);
    res.send(csv);

    logger.info('CSV downloaded', { scanId, userId });

  } catch (error) {
    logger.error('Error downloading CSV:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download CSV'
    });
  }
});

// GET /engagers/scans - List all scans for user
router.get('/scans', authenticateApiKey, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await engagersService.listScans(userId, limit, offset);

    const scans = result.scans.map(scan => ({
      scan_id: scan.id,
      post_url: scan.post_url,
      status: scan.status,
      total_engagers: scan.total_engagers || 0,
      unique_profiles: scan.unique_profiles || 0,
      profiles_enriched: scan.profiles_enriched || 0,
      companies_enriched: scan.companies_enriched || 0,
      created_at: scan.created_at,
      completed_at: scan.completed_at
    }));

    res.json({ success: true, scans });

  } catch (error) {
    logger.error('Error listing scans:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch scans'
    });
  }
});

module.exports = router;
