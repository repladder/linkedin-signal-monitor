# 🔄 Migration Guide: Lemon Squeezy → Razorpay

If you already deployed with Lemon Squeezy, follow these steps to migrate to Razorpay.

## ⚠️ Important Notes

- This migration is necessary for Indian users
- No data will be lost
- Existing profiles will remain intact
- Takes about 15-20 minutes

## 📋 Migration Steps

### Step 1: Update Your Local Code

1. **Pull the latest code** from GitHub:
   ```bash
   cd linkedin-signal-monitor
   git pull origin main
   ```

2. **Install new dependencies**:
   ```bash
   npm install
   ```

### Step 2: Update Database Schema

Go to Supabase SQL Editor and run:

```sql
-- Add Razorpay columns
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT;

-- Optional: Remove old Lemon Squeezy columns
ALTER TABLE users 
  DROP COLUMN IF EXISTS lemonsqueezy_customer_id,
  DROP COLUMN IF EXISTS lemonsqueezy_subscription_id;
```

### Step 3: Set Up Razorpay

Follow the **RAZORPAY_SETUP.md** guide to:
1. Create Razorpay account
2. Get API keys
3. Create subscription plans
4. Set up webhooks

### Step 4: Update Environment Variables

#### Locally (.env file):

Remove these:
```env
# DELETE THESE
LEMONSQUEEZY_API_KEY=...
LEMONSQUEEZY_WEBHOOK_SECRET=...
BASIC_VARIANT_ID=...
BUSINESS_VARIANT_ID=...
```

Add these:
```env
# ADD THESE
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
RAZORPAY_BASIC_PLAN_ID=plan_xxxxxxxxxxxxx
RAZORPAY_BUSINESS_PLAN_ID=plan_xxxxxxxxxxxxx
```

#### On Railway:

1. Go to your project → **Variables** tab
2. **Delete** old Lemon Squeezy variables
3. **Add** new Razorpay variables (same as above)
4. Railway will auto-redeploy

### Step 5: Update Webhook URLs

1. **In Razorpay Dashboard**:
   - Add webhook: `https://YOUR-RAILWAY-URL.up.railway.app/razorpay/webhook`

2. **Remove old Lemon Squeezy webhook** (optional cleanup)

### Step 6: Test the Migration

1. **Check health endpoint**:
   ```bash
   curl https://your-railway-url.up.railway.app/health
   ```

2. **Test subscription creation**:
   ```bash
   curl -X POST https://your-url/billing/create-subscription \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"plan": "basic"}'
   ```

3. **Verify webhook** by completing a test payment

### Step 7: Verify Everything Works

✅ Server starts without errors
✅ API responds to requests
✅ Can create subscriptions
✅ Webhooks are received
✅ Plan updates work

## 🔄 What Changed

### Code Changes:
- ❌ Removed: `src/routes/webhook.js` (Lemon Squeezy version)
- ✅ Added: `src/routes/webhook.js` (Razorpay version)
- ✅ Updated: `src/routes/billing.js` (added create-subscription endpoint)
- ✅ Updated: `src/server.js` (Razorpay env vars)
- ✅ Updated: `schema.sql` (Razorpay columns)
- ✅ Updated: `package.json` (added razorpay SDK)

### Endpoint Changes:
- ❌ Removed: `/lemonsqueezy/webhook`
- ✅ Added: `/razorpay/webhook`
- ✅ Added: `POST /billing/create-subscription`

### Environment Variables:
- ❌ Removed: All LEMONSQUEEZY_* variables
- ❌ Removed: BASIC_VARIANT_ID, BUSINESS_VARIANT_ID
- ✅ Added: All RAZORPAY_* variables

## 💾 Handling Existing Paid Users

If you already have paying customers on Lemon Squeezy:

### Option 1: Manual Migration
1. Export customer list from Lemon Squeezy
2. Contact each customer
3. Cancel Lemon Squeezy subscription
4. Create Razorpay subscription
5. Update plan in database manually

### Option 2: Dual System (Temporary)
1. Keep both payment systems running
2. New customers use Razorpay
3. Existing customers stay on Lemon Squeezy
4. Gradually migrate over time

### Manual Plan Update SQL:
```sql
-- Update a specific user's plan
UPDATE users 
SET plan = 'basic'
WHERE email = 'customer@example.com';
```

## 🐛 Troubleshooting

### Server won't start after update
**Error**: `RAZORPAY_KEY_ID is required`
**Fix**: Make sure all Razorpay env variables are set

### Webhooks not working
**Check**:
1. Webhook URL is correct in Razorpay Dashboard
2. Webhook secret matches exactly
3. Check Railway logs for errors

### Plans not updating
**Check**:
1. Plan IDs in env match Razorpay Dashboard
2. Webhook signature is valid
3. User exists in database

## ✅ Migration Checklist

- [ ] Updated local code (`git pull`)
- [ ] Installed new dependencies (`npm install`)
- [ ] Updated database schema in Supabase
- [ ] Created Razorpay account
- [ ] Generated API keys
- [ ] Created subscription plans in Razorpay
- [ ] Set up webhook in Razorpay Dashboard
- [ ] Updated local `.env` file
- [ ] Updated Railway environment variables
- [ ] Tested health endpoint
- [ ] Tested subscription creation
- [ ] Verified webhook delivery
- [ ] Confirmed plan updates work

## 📊 After Migration

You should see in Railway logs:
```
✅ Database connection verified
✅ Server running on port 3000
🔄 Scheduler running - scans every hour
```

And be able to:
- Create subscriptions via API
- Receive webhook events
- See plan updates in Supabase

## 🎉 You're Done!

Your API is now using Razorpay for Indian payment processing!

**Next**: Start accepting subscriptions and building your customer base.

---

**Questions?** Check RAZORPAY_SETUP.md or review Railway logs for any errors.
