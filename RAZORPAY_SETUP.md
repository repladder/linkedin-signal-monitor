# 🇮🇳 Razorpay Integration Guide

This guide explains how to set up Razorpay for subscription billing in your LinkedIn Signal Monitor API.

## 🎯 What Changed

Razorpay has replaced Lemon Squeezy for payment processing because:
- ✅ Razorpay works in India without Stripe verification
- ✅ Supports INR and international currencies
- ✅ Full subscription management
- ✅ Secure webhook system

## 📋 Razorpay Setup Steps

### Step 1: Create Razorpay Account

1. Go to [razorpay.com](https://razorpay.com)
2. Click **"Sign Up"**
3. Complete KYC verification (required for live mode)
4. For now, you can use **Test Mode** to develop

### Step 2: Get API Keys

1. In Razorpay Dashboard, go to **Settings** → **API Keys**
2. Generate keys for **Test Mode** first
3. You'll get:
   - **Key ID** (starts with `rzp_test_`)
   - **Key Secret** (keep this secret!)
4. Save both - you'll add them to `.env` later

### Step 3: Create Subscription Plans

1. In Razorpay Dashboard, go to **Subscriptions** → **Plans**
2. Click **"Create Plan"**

**Basic Plan:**
- Plan Name: `Basic Plan`
- Billing Cycle: Monthly
- Amount: ₹2,000 (or $29 if you can use USD)
- Trial Period: 0 days (or add trial if you want)
- Click **Create**
- **Copy the Plan ID** (looks like `plan_xxxxxxxxxxxxx`)

**Business Plan:**
- Plan Name: `Business Plan`
- Billing Cycle: Monthly
- Amount: ₹7,000 (or $99 if USD)
- Trial Period: 0 days
- Click **Create**
- **Copy the Plan ID**

### Step 4: Set Up Webhooks

1. Go to **Settings** → **Webhooks**
2. Click **"+ Add New Webhook"**
3. Fill in:
   - **Webhook URL**: `https://YOUR-DOMAIN/razorpay/webhook`
     - For now, use: `https://YOUR-RAILWAY-URL.up.railway.app/razorpay/webhook`
   - **Secret**: Create a strong random string (e.g., `rzp_webhook_secret_xxx`)
   - **Events**: Select these:
     - `subscription.activated`
     - `subscription.charged`
     - `subscription.cancelled`
     - `subscription.completed`
4. Click **Create Webhook**
5. **Save your webhook secret** - you'll need it in `.env`

### Step 5: Update Environment Variables

Add these to your `.env` file (and Railway):

```env
# Razorpay Configuration
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_key_secret_here
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
RAZORPAY_BASIC_PLAN_ID=plan_xxxxxxxxxxxxx
RAZORPAY_BUSINESS_PLAN_ID=plan_xxxxxxxxxxxxx
```

### Step 6: Update Database Schema

Run this in Supabase SQL Editor to update your users table:

```sql
-- Add Razorpay columns to users table
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT;

-- Remove old Lemon Squeezy columns (optional)
ALTER TABLE users 
  DROP COLUMN IF EXISTS lemonsqueezy_customer_id,
  DROP COLUMN IF EXISTS lemonsqueezy_subscription_id;
```

## 🚀 How It Works

### For Your Users:

1. **User calls**: `POST /billing/create-subscription` with `{"plan": "basic"}`
2. **API creates** Razorpay customer (if new)
3. **API creates** subscription and returns a checkout link
4. **User clicks** the `short_url` to complete payment
5. **Razorpay sends** webhook when payment succeeds
6. **API updates** user's plan to "basic"
7. **User can now** add up to 1,000 profiles!

### Subscription Flow:

```
User Request → Create Customer → Create Subscription → Get Checkout URL
    ↓
User Pays → Razorpay Webhook → Update Plan in Database
    ↓
Plan Limits Automatically Applied
```

## 📡 API Endpoints

### Create Subscription

```bash
curl -X POST https://your-domain/billing/create-subscription \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"plan": "basic"}'
```

**Response:**
```json
{
  "success": true,
  "subscription_id": "sub_xxxxxxxxxxxxx",
  "short_url": "https://rzp.io/i/xxxxx",
  "status": "created",
  "message": "Please complete payment at the provided URL"
}
```

User visits `short_url` to complete payment.

### Webhook Endpoint

Razorpay automatically sends events to:
```
POST /razorpay/webhook
```

This endpoint:
- ✅ Verifies webhook signature
- ✅ Handles subscription.activated → upgrades plan
- ✅ Handles subscription.cancelled → downgrades to free
- ✅ Logs all events

## 🔐 Security

The webhook handler:
1. **Verifies signature** using HMAC SHA256
2. **Rejects invalid** signatures immediately
3. **Prevents** unauthorized plan updates
4. **Logs** all webhook events

## 🧪 Testing in Test Mode

### Test Cards for India:

**Successful Payment:**
- Card: `4111 1111 1111 1111`
- CVV: Any 3 digits
- Expiry: Any future date

**Failed Payment:**
- Card: `4000 0000 0000 0002`

### Test the Flow:

1. Create a test user in your database
2. Get their API key
3. Call `POST /billing/create-subscription` with test mode keys
4. Use test card to complete payment
5. Check webhook logs in Razorpay Dashboard
6. Verify user's plan updated in Supabase

## 💰 Pricing Recommendations

### For Indian Market (INR):
- **Free**: 200 profiles
- **Basic**: ₹1,999/month - 1,000 profiles
- **Business**: ₹6,999/month - 10,000 profiles

### For International (USD):
- **Free**: 200 profiles
- **Basic**: $29/month - 1,000 profiles
- **Business**: $99/month - 10,000 profiles

## 🔄 Migration from Test to Live

When ready for production:

1. Complete KYC in Razorpay Dashboard
2. Activate **Live Mode**
3. Create new API keys for Live Mode
4. Create plans again in Live Mode
5. Update webhook URL for Live Mode
6. Update `.env` with live keys
7. Deploy to Railway

## 📊 Razorpay Dashboard

Monitor your business:
- **Transactions** → See all payments
- **Subscriptions** → Manage active subscriptions
- **Analytics** → Revenue insights
- **Webhooks** → Debug webhook deliveries

## ❓ Common Issues

### "Invalid Signature" Error
- Check `RAZORPAY_WEBHOOK_SECRET` matches exactly
- Verify webhook secret in Razorpay Dashboard

### Subscription Not Activating
- Check Railway logs for webhook events
- Verify plan IDs are correct
- Check user was found in database

### Payment Gateway Not Loading
- Verify API keys are for correct mode (test/live)
- Check Razorpay account status

## 🎉 You're Done!

Your API now:
- ✅ Creates Razorpay subscriptions
- ✅ Handles payments automatically
- ✅ Upgrades/downgrades users
- ✅ Works in India
- ✅ Supports INR and international currencies

## 📞 Support

- **Razorpay Docs**: [razorpay.com/docs](https://razorpay.com/docs)
- **API Reference**: [razorpay.com/docs/api](https://razorpay.com/docs/api)
- **Support**: support@razorpay.com

---

**Next Steps**: Update your Railway environment variables and test the subscription flow!
