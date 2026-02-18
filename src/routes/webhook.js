const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { supabase } = require('../utils/db');
const logger = require('../utils/logger');

const router = express.Router();

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

/**
 * Verify Razorpay webhook signature
 */
function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * POST /razorpay/webhook
 * Handle Razorpay webhook events
 */
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!signature || !secret) {
      logger.warn('Missing webhook signature or secret');
      return res.status(400).json({ error: 'Missing signature' });
    }

    // Verify signature
    const isValid = verifyWebhookSignature(req.body, signature, secret);
    
    if (!isValid) {
      logger.warn('Invalid Razorpay webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse payload
    const event = JSON.parse(req.body.toString());
    const eventType = event.event;

    logger.info('Received Razorpay webhook', { eventType });

    // Handle different event types
    switch (eventType) {
      case 'subscription.activated':
        await handleSubscriptionActivated(event);
        break;
      
      case 'subscription.charged':
        await handleSubscriptionCharged(event);
        break;
      
      case 'subscription.cancelled':
      case 'subscription.completed':
        await handleSubscriptionCancelled(event);
        break;
      
      default:
        logger.info('Unhandled webhook event', { eventType });
    }

    res.status(200).json({ status: 'ok' });

  } catch (error) {
    logger.error('Razorpay webhook processing error', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Handle subscription activated event
 */
async function handleSubscriptionActivated(event) {
  try {
    const subscription = event.payload.subscription.entity;
    const subscriptionId = subscription.id;
    const customerId = subscription.customer_id;
    const planId = subscription.plan_id;
    const customerEmail = subscription.customer_notify ? subscription.notes?.email : null;

    // Determine plan based on plan_id
    const plan = determinePlan(planId);

    if (!plan) {
      logger.warn('Unknown Razorpay plan ID', { planId });
      return;
    }

    // Find user by subscription_id or customer_id
    let { data: user, error: findError } = await supabase
      .from('users')
      .select('*')
      .or(`razorpay_subscription_id.eq.${subscriptionId},razorpay_customer_id.eq.${customerId}`)
      .single();

    if (findError && findError.code !== 'PGRST116') {
      logger.error('Error finding user for subscription', findError);
      return;
    }

    if (user) {
      // Update existing user
      const { error: updateError } = await supabase
        .from('users')
        .update({
          plan,
          razorpay_customer_id: customerId,
          razorpay_subscription_id: subscriptionId
        })
        .eq('id', user.id);

      if (updateError) {
        logger.error('Failed to update user subscription', updateError);
        return;
      }

      logger.info('User subscription activated', { 
        userId: user.id, 
        plan 
      });
    } else {
      logger.warn('No user found for subscription activation', { 
        subscriptionId, 
        customerId 
      });
    }

  } catch (error) {
    logger.error('Error handling subscription_activated', error);
  }
}

/**
 * Handle subscription charged event (payment successful)
 */
async function handleSubscriptionCharged(event) {
  try {
    const payment = event.payload.payment.entity;
    const subscriptionId = payment.subscription_id;

    logger.info('Subscription payment received', { 
      subscriptionId,
      amount: payment.amount,
      status: payment.status
    });

    // Optional: Update last payment date or store payment history
    // For now, we just log it

  } catch (error) {
    logger.error('Error handling subscription_charged', error);
  }
}

/**
 * Handle subscription cancelled/completed event
 */
async function handleSubscriptionCancelled(event) {
  try {
    const subscription = event.payload.subscription.entity;
    const subscriptionId = subscription.id;

    // Downgrade to free plan
    const { error } = await supabase
      .from('users')
      .update({ 
        plan: 'free',
        razorpay_subscription_id: null
      })
      .eq('razorpay_subscription_id', subscriptionId);

    if (error) {
      logger.error('Failed to downgrade user to free', error);
      return;
    }

    logger.info('User downgraded to free plan', { subscriptionId });

    // Note: We do NOT delete profiles, only enforce limits going forward

  } catch (error) {
    logger.error('Error handling subscription cancellation', error);
  }
}

/**
 * Map Razorpay plan ID to internal plan name
 */
function determinePlan(planId) {
  const basicPlanId = process.env.RAZORPAY_BASIC_PLAN_ID;
  const businessPlanId = process.env.RAZORPAY_BUSINESS_PLAN_ID;

  if (planId === basicPlanId) {
    return 'basic';
  } else if (planId === businessPlanId) {
    return 'business';
  }

  return null;
}

module.exports = router;
