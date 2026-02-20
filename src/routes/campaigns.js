const express = require('express');
const router = express.Router();
const { authenticateApiKey: authenticateToken } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../utils/db');
const logger = require('../utils/logger');

// GET /campaigns - List all campaigns
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select(`
        *,
        profiles:profiles(count),
        profile_signals:profile_signals(count)
      `)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Format response with counts
    const formattedCampaigns = campaigns.map(campaign => ({
      ...campaign,
      profile_count: campaign.profiles?.[0]?.count || 0,
      signals_detected: campaign.profile_signals?.[0]?.count || 0
    }));

    res.json({
      success: true,
      campaigns: formattedCampaigns
    });
  } catch (error) {
    logger.error('Error fetching campaigns:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch campaigns'
    });
  }
});

// GET /campaigns/:id - Get campaign details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (campaignError || !campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    const { count: profileCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id);

    const { count: signalCount } = await supabase
      .from('profile_signals')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id);

    res.json({
      success: true,
      campaign: {
        ...campaign,
        profile_count: profileCount || 0,
        signals_detected: signalCount || 0
      }
    });
  } catch (error) {
    logger.error('Error fetching campaign:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch campaign'
    });
  }
});

// POST /campaigns - Create new campaign
router.post(
  '/',
  authenticateToken,
  [
    body('name').trim().notEmpty().withMessage('Campaign name is required'),
    body('signal_types').isArray({ min: 1 }).withMessage('At least one signal type required'),
    body('description').optional().trim()
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
      const { name, description, signal_types } = req.body;

      const { data: campaign, error } = await supabase
        .from('campaigns')
        .insert({
          user_id: req.user.id,
          name,
          description: description || null,
          signal_types,
          status: 'active'
        })
        .select()
        .single();

      if (error) throw error;

      logger.info('Campaign created', {
        campaignId: campaign.id,
        userId: req.user.id,
        name
      });

      res.status(201).json({
        success: true,
        campaign
      });
    } catch (error) {
      logger.error('Error creating campaign:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create campaign'
      });
    }
  }
);

// PATCH /campaigns/:id - Update campaign
router.patch(
  '/:id',
  authenticateToken,
  [
    body('name').optional().trim().notEmpty(),
    body('description').optional().trim(),
    body('signal_types').optional().isArray({ min: 1 }),
    body('status').optional().isIn(['active', 'paused', 'completed', 'archived'])
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const { data: campaign, error } = await supabase
        .from('campaigns')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('user_id', req.user.id)
        .select()
        .single();

      if (error || !campaign) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found'
        });
      }

      logger.info('Campaign updated', { campaignId: id });

      res.json({
        success: true,
        campaign
      });
    } catch (error) {
      logger.error('Error updating campaign:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update campaign'
      });
    }
  }
);

// DELETE /campaigns/:id - Delete campaign
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('campaigns')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);

    if (error) throw error;

    logger.info('Campaign deleted', { campaignId: id });

    res.json({
      success: true,
      message: 'Campaign deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting campaign:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete campaign'
    });
  }
});

// GET /campaigns/:id/signals - Get signals for campaign
router.get('/:id/signals', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    const { data: profileSignals, error } = await supabase
      .from('profile_signals')
      .select(`
        *,
        profile:profiles!inner(
          linkedin_url
        ),
        posts:events!inner(
          id,
          keyword,
          post_url,
          post_date,
          snippet
        )
      `)
      .eq('campaign_id', id)
      .order('detected_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const signals = profileSignals.map(ps => ({
      profile_id: ps.profile_id,
      linkedin_url: ps.linkedin_url,
      profile_name: ps.profile_name,
      profile_title: ps.profile_title,
      signals: ps.signals,
      total_posts: ps.total_posts,
      detected_at: ps.detected_at,
      posts: ps.posts || []
    }));

    res.json({
      success: true,
      signals
    });
  } catch (error) {
    logger.error('Error fetching campaign signals:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch signals'
    });
  }
});

// POST /campaigns/:id/profiles - Add profiles to campaign
router.post(
  '/:id/profiles',
  authenticateToken,
  [
    body('linkedin_urls').isArray({ min: 1 }).withMessage('At least one LinkedIn URL required')
  ],
  async (req, res) => {
    try {
      const { id: campaignId } = req.params;
      const { linkedin_urls } = req.body;

      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaignId)
        .eq('user_id', req.user.id)
        .single();

      if (campaignError || !campaign) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found'
        });
      }

      const signalTemplates = require('../types/signal-templates');
      const profiles = linkedin_urls.map(url => ({
        user_id: req.user.id,
        campaign_id: campaignId,
        linkedin_url: url,
        keywords: campaign.signal_types.flatMap(type => signalTemplates[type] || []),
        next_scan_at: new Date().toISOString()
      }));

      const { data: addedProfiles, error } = await supabase
        .from('profiles')
        .insert(profiles)
        .select();

      if (error) throw error;

      logger.info('Profiles added to campaign', {
        campaignId,
        count: addedProfiles.length
      });

      res.status(201).json({
        success: true,
        message: `${addedProfiles.length} profiles added to campaign`,
        profiles: addedProfiles
      });
    } catch (error) {
      logger.error('Error adding profiles to campaign:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add profiles'
      });
    }
  }
);

// GET /campaigns/:id/stream - Server-Sent Events for real-time updates
router.get('/:id/stream', authenticateToken, async (req, res) => {
  const { id: campaignId } = req.params;

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('user_id', req.user.id)
    .single();

  if (!campaign) {
    return res.status(404).json({
      success: false,
      error: 'Campaign not found'
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(`data: ${JSON.stringify({ type: 'connected', campaignId })}\n\n`);

  const subscription = supabase
    .channel(`campaign:${campaignId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'profile_signals',
        filter: `campaign_id=eq.${campaignId}`
      },
      (payload) => {
        res.write(`data: ${JSON.stringify({
          type: 'signal_detected',
          data: payload.new
        })}\n\n`);
      }
    )
    .subscribe();

  req.on('close', () => {
    subscription.unsubscribe();
  });
});

module.exports = router;
