const express = require('express');
const Razorpay = require('razorpay');
const { supabase } = require('../utils/db');
const logger = require('../utils/logger');
const { authenticateApiKey } = require('../middleware/auth');
const schedulerService = require('../services/scheduler');

const router = express.Router();

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

/**
 * POST /billing/create-subscription
 * Create a new Razorpay subscription
 */
router.post('/create-subscription', authenticateApiKey, async (req, res) => {
  try {
    const { plan } = req.body;

    // Validate plan
    if (!plan || !['basic', 'business'].includes(plan)) {
      return res.status(400).json({ 
        error: 'Invalid plan. Must be "basic" or "business"' 
      });
    }

    // Get plan ID from environment
    const planId = plan === 'basic' 
      ? process.env.RAZORPAY_BASIC_PLAN_ID 
      : process.env.RAZORPAY_BUSINESS_PLAN_ID;

    if (!planId) {
      logger.error('Missing Razorpay plan ID in environment', { plan });
      return res.status(500).json({ 
        error: 'Plan configuration error' 
      });
    }

    // Check if user already has a customer ID
    let customerId = req.user.razorpay_customer_id;

    // Create Razorpay customer if doesn't exist
    if (!customerId) {
      try {
        const customer = await razorpay.customers.create({
          email: req.user.email,
          fail_existing: 0 // Don't fail if customer exists
        });

        customerId = customer.id;

        // Save customer ID
        await supabase
          .from('users')
          .update({ razorpay_customer_id: customerId })
          .eq('id', req.user.id);

        logger.info('Created Razorpay customer', { 
          userId: req.user.id, 
          customerId 
        });
      } catch (error) {
        logger.error('Failed to create Razorpay customer', error);
        return res.status(500).json({ 
          error: 'Failed to create customer' 
        });
      }
    }

    // Create subscription
    try {
      const subscription = await razorpay.subscriptions.create({
        plan_id: planId,
        customer_notify: 1,
        total_count: 12, // 12 months, or set to 0 for unlimited
        notes: {
          user_id: req.user.id,
          email: req.user.email
        }
      });

      // Save subscription ID
      await supabase
        .from('users')
        .update({ razorpay_subscription_id: subscription.id })
        .eq('id', req.user.id);

      logger.info('Created Razorpay subscription', { 
        userId: req.user.id, 
        subscriptionId: subscription.id,
        plan 
      });

      res.json({
        success: true,
        subscription_id: subscription.id,
        short_url: subscription.short_url,
        status: subscription.status,
        message: 'Please complete payment at the provided URL'
      });

    } catch (error) {
      logger.error('Failed to create subscription', error);
      return res.status(500).json({ 
        error: 'Failed to create subscription',
        details: error.message
      });
    }

  } catch (error) {
    logger.error('Error in create-subscription endpoint', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /webhook
 * Configure webhook URL for the user
 */
router.post('/', authenticateApiKey, async (req, res) => {
  try {
    const { webhook_url } = req.body;

    // Validation
    if (!webhook_url) {
      return res.status(400).json({ 
        error: 'webhook_url is required' 
      });
    }

    // Basic URL validation
    try {
      new URL(webhook_url);
    } catch (err) {
      return res.status(400).json({ 
        error: 'Invalid webhook_url. Must be a valid HTTP/HTTPS URL' 
      });
    }

    // Update user's webhook URL
    const { error } = await supabase
      .from('users')
      .update({ webhook_url })
      .eq('id', req.user.id);

    if (error) {
      logger.error('Failed to update webhook URL', error);
      return res.status(500).json({ error: 'Failed to update webhook URL' });
    }

    logger.info('Webhook URL updated', { 
      userId: req.user.id, 
      webhookUrl: webhook_url 
    });

    res.json({
      success: true,
      message: 'Webhook URL configured successfully',
      webhook_url
    });

  } catch (error) {
    logger.error('Error configuring webhook', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /webhook
 * Remove webhook URL
 */
router.delete('/', authenticateApiKey, async (req, res) => {
  try {
    const { error } = await supabase
      .from('users')
      .update({ webhook_url: null })
      .eq('id', req.user.id);

    if (error) {
      logger.error('Failed to remove webhook URL', error);
      return res.status(500).json({ error: 'Failed to remove webhook URL' });
    }

    logger.info('Webhook URL removed', { userId: req.user.id });

    res.json({
      success: true,
      message: 'Webhook URL removed'
    });

  } catch (error) {
    logger.error('Error removing webhook', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /scan-now
 * Manually trigger a scan for user's profiles (useful for testing)
 */
router.post('/scan-now', authenticateApiKey, async (req, res) => {
  try {
    // Get user's profiles
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, linkedin_url')
      .eq('user_id', req.user.id)
      .limit(10); // Limit manual scans to 10 profiles at a time

    if (error) {
      logger.error('Failed to fetch profiles for manual scan', error);
      return res.status(500).json({ error: 'Failed to fetch profiles' });
    }

    if (!profiles || profiles.length === 0) {
      return res.status(404).json({ 
        error: 'No profiles found to scan' 
      });
    }

    // Update next_scan_at to trigger immediate scan
    const now = new Date().toISOString();
    
    for (const profile of profiles) {
      await supabase
        .from('profiles')
        .update({ next_scan_at: now })
        .eq('id', profile.id);
    }

    logger.info('Manual scan triggered', { 
      userId: req.user.id, 
      profileCount: profiles.length 
    });

    res.json({
      success: true,
      message: `Queued ${profiles.length} profiles for immediate scanning`,
      profiles_queued: profiles.length,
      note: 'Profiles will be scanned in the next scheduler cycle (within 1 hour)'
    });

  } catch (error) {
    logger.error('Error triggering manual scan', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
