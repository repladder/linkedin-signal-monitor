const express = require('express');
const { supabase } = require('../utils/db');
const logger = require('../utils/logger');
const { authenticateApiKey } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /profiles
 * Create a new profile to monitor
 */
router.post('/', authenticateApiKey, async (req, res) => {
  try {
    const { linkedin_url, keywords } = req.body;

    // Validation
    if (!linkedin_url || !keywords) {
      return res.status(400).json({ 
        error: 'Missing required fields: linkedin_url, keywords' 
      });
    }

    if (!Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ 
        error: 'keywords must be a non-empty array' 
      });
    }

    // Validate LinkedIn URL format
    if (!linkedin_url.includes('linkedin.com/in/')) {
      return res.status(400).json({ 
        error: 'Invalid LinkedIn URL. Must be a profile URL (linkedin.com/in/...)' 
      });
    }

    // Check plan limit
    const { count, error: countError } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id);

    if (countError) {
      logger.error('Failed to count profiles', countError);
      return res.status(500).json({ error: 'Failed to check profile limit' });
    }

    if (count >= req.planLimit) {
      return res.status(403).json({ 
        error: `Profile limit reached. Your ${req.user.plan} plan allows ${req.planLimit} profiles. Upgrade your plan to monitor more profiles.`,
        current_count: count,
        plan_limit: req.planLimit,
        plan: req.user.plan
      });
    }

    // Create profile
    const { data: profile, error: insertError } = await supabase
      .from('profiles')
      .insert({
        user_id: req.user.id,
        linkedin_url,
        keywords,
        next_scan_at: new Date().toISOString() // Scan ASAP
      })
      .select()
      .single();

    if (insertError) {
      logger.error('Failed to create profile', insertError);
      return res.status(500).json({ error: 'Failed to create profile' });
    }

    logger.info('Profile created', { 
      profileId: profile.id, 
      userId: req.user.id 
    });

    res.status(201).json({
      success: true,
      profile: {
        id: profile.id,
        linkedin_url: profile.linkedin_url,
        keywords: profile.keywords,
        created_at: profile.created_at
      }
    });

  } catch (error) {
    logger.error('Error creating profile', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /profiles
 * Get all profiles for the authenticated user
 */
router.get('/', authenticateApiKey, async (req, res) => {
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, linkedin_url, keywords, last_post_timestamp, next_scan_at, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch profiles', error);
      return res.status(500).json({ error: 'Failed to fetch profiles' });
    }

    res.json({
      success: true,
      count: profiles.length,
      plan_limit: req.planLimit,
      profiles
    });

  } catch (error) {
    logger.error('Error fetching profiles', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /profiles/:id
 * Delete a profile
 */
router.delete('/:id', authenticateApiKey, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership and delete
    const { data, error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id) // Ensure user owns this profile
      .select();

    if (error) {
      logger.error('Failed to delete profile', error);
      return res.status(500).json({ error: 'Failed to delete profile' });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Profile not found or unauthorized' });
    }

    logger.info('Profile deleted', { 
      profileId: id, 
      userId: req.user.id 
    });

    res.json({
      success: true,
      message: 'Profile deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting profile', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /profiles/:id
 * Update profile keywords
 */
router.patch('/:id', authenticateApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { keywords } = req.body;

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ 
        error: 'keywords must be a non-empty array' 
      });
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({ keywords })
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update profile', error);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Profile not found or unauthorized' });
    }

    logger.info('Profile updated', { profileId: id, userId: req.user.id });

    res.json({
      success: true,
      profile: {
        id: data.id,
        linkedin_url: data.linkedin_url,
        keywords: data.keywords,
        updated_at: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error updating profile', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
