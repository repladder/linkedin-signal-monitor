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

    // Get campaign
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

    // Get profile count
    const { count: profileCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id);

    // Get signal count
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

    // Verify campaign belongs to user
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

    // Get profile signals
    const { data: profileSignals, error } = await supabase
      .from('profile_signals')
      .select('*')
      .eq('campaign_id', id)
      .order('detected_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) throw error;

    // For each profile signal, get the actual posts
    const signalsWithPosts = await Promise.all(
      profileSignals.map(async (ps) => {
        const { data: posts } = await supabase
          .from('events')
          .select('id, keyword, post_url, post_date, snippet')
          .eq('profile_id', ps.profile_id)
          .order('post_date', { ascending: false });

        return {
          profile_id: ps.profile_id,
          linkedin_url: ps.linkedin_url,
          profile_name: ps.profile_name,
          profile_title: ps.profile_title,
          signals: ps.signals,
          total_posts: ps.total_posts,
          detected_at: ps.detected_at,
          posts: posts || []
        };
      })
    );

    res.json({
      success: true,
      signals: signalsWithPosts
    });
  } catch (error) {
    logger.error('Error fetching campaign signals:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch signals'
    });
  }
});

// POST /campaigns/:id/profiles - Add profiles to campaign and trigger scan
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

      // Verify campaign belongs to user
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

      // Get keywords for signal types
      const SIGNAL_TEMPLATES = {
        track_all: [
          'raised', 'seed round', 'series a', 'series b', 'funding', 'backed by', 'venture', 'investors',
          'hiring sdr', 'hiring ae', 'building sales team', 'account executive',
          'we\'re hiring', 'join our team', 'open positions', 'now hiring', 'recruiting',
          'excited to announce', 'starting my new', 'joined', 'joining', 'new role',
          'launching', 'just launched', 'now live', 'introducing',
          'expanding to', 'new office', 'entering market'
        ],
        funding: ['raised', 'seed round', 'series a', 'series b', 'series c', 'funding', 'backed by', 'venture', 'investors', 'investment', 'closing our'],
        hiring_sales: ['hiring sdr', 'hiring ae', 'building sales team', 'first sales hire', 'business development', 'account executive', 'sales development', 'looking for sales', 'join our sales team', 'sales manager', 'head of sales'],
        hiring: ['we are hiring', 'we\'re hiring', 'join our team', 'looking for', 'open positions', 'now hiring', 'come work', 'join us', 'hiring for', 'seeking', 'recruiting', 'job opening', 'career opportunity', 'grow our team', 'expanding our team'],
        new_role: ['excited to announce', 'thrilled to share', 'happy to share', 'pleased to announce', 'starting my new', 'joined', 'joining', 'new role', 'new position', 'new chapter', 'accepted a position', 'accepted an offer', 'stepping into', 'transition to', 'moving to'],
        launch: ['launching', 'now live', 'beta', 'new product', 'introducing', 'excited to announce', 'just launched', 'available now', 'officially live', 'proud to announce'],
        expansion: ['expanding to', 'entering market', 'scaling operations', 'growing team', 'new office', 'international expansion', 'opening office', 'global expansion', 'new market']
      };

      const allKeywords = campaign.signal_types.flatMap(type =>
        SIGNAL_TEMPLATES[type] || []
      );

      // Remove duplicates
      const uniqueKeywords = [...new Set(allKeywords)];

      // Add profiles
      const profiles = linkedin_urls.map(url => ({
        user_id: req.user.id,
        campaign_id: campaignId,
        linkedin_url: url,
        keywords: uniqueKeywords,
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

      // 🔥 TRIGGER APIFY SCAN IMMEDIATELY IN BACKGROUND
      const apifyService = require('../services/apify');
      const matchingService = require('../services/matching');

      // Process profiles in background (don't wait for response)
      setImmediate(async () => {
        for (const profile of addedProfiles) {
          try {
            logger.info('🚀 Starting Apify scan for profile', {
              profileId: profile.id,
              linkedinUrl: profile.linkedin_url
            });

            // scanProfiles takes an array and returns [{ linkedin_url, posts }]
            const results = await apifyService.scanProfiles([profile.linkedin_url]);
            const posts = results[0]?.posts || [];

            logger.info('📊 Apify scan completed', {
              profileId: profile.id,
              postsFound: posts.length
            });

            // Match keywords against posts
            for (const post of posts) {
              const events = matchingService.processPost(
                post,
                profile.keywords,
                profile.id
              );

              // Save matched events to database
              if (events.length > 0) {
                const { error: eventError } = await supabase
                  .from('events')
                  .insert(events);

                if (eventError) {
                  logger.error('Error saving events', {
                    profileId: profile.id,
                    error: eventError
                  });
                } else {
                  logger.info('✅ Events saved', {
                    profileId: profile.id,
                    eventCount: events.length,
                    keywords: events.map(e => e.keyword)
                  });
                }
              }
            }

            // Update profile scan timestamp
            await supabase
              .from('profiles')
              .update({
                last_post_timestamp: new Date().toISOString(),
                next_scan_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
              })
              .eq('id', profile.id);

          } catch (scanError) {
            logger.error('❌ Error scanning profile', {
              profileId: profile.id,
              linkedinUrl: profile.linkedin_url,
              error: scanError.message,
              stack: scanError.stack
            });
          }
        }

        logger.info('🎯 Background scanning complete for campaign', {
          campaignId,
          profileCount: addedProfiles.length
        });
      });

      // Return success immediately (scanning happens in background)
      res.status(201).json({
        success: true,
        message: `${addedProfiles.length} profiles added. Scanning started in background...`,
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

  try {
    // Verify campaign belongs to user
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

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    logger.info('SSE connection established', {
      campaignId,
      userId: req.user.id
    });

    // Send initial connection message
    res.write(`data: ${JSON.stringify({
      type: 'connected',
      campaignId,
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
      res.write(`data: ${JSON.stringify({
        type: 'heartbeat',
        timestamp: new Date().toISOString()
      })}\n\n`);
    }, 30000);

    // Subscribe to profile_signals changes via Supabase Realtime
    const channel = supabase.channel(`campaign:${campaignId}`);

    channel
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profile_signals',
          filter: `campaign_id=eq.${campaignId}`
        },
        async (payload) => {
          logger.info('SSE: Signal detected', {
            event: payload.eventType,
            profileId: payload.new?.profile_id
          });

          // Get posts for this profile signal
          const { data: posts } = await supabase
            .from('events')
            .select('id, keyword, post_url, post_date, snippet')
            .eq('profile_id', payload.new.profile_id)
            .order('post_date', { ascending: false });

          res.write(`data: ${JSON.stringify({
            type: 'signal_detected',
            data: {
              ...payload.new,
              posts: posts || []
            },
            timestamp: new Date().toISOString()
          })}\n\n`);
        }
      )
      .subscribe((status) => {
        logger.info('Supabase Realtime subscription status:', {
          status,
          campaignId
        });
      });

    // Cleanup on client disconnect
    req.on('close', () => {
      logger.info('SSE connection closed', { campaignId });
      clearInterval(heartbeatInterval);
      channel.unsubscribe();
    });

  } catch (error) {
    logger.error('SSE connection error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to establish SSE connection'
    });
  }
});

module.exports = router;
