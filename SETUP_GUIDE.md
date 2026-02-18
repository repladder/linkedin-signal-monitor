# 🚀 Setup Guide for Non-Coders

Welcome! This guide will walk you through setting up your LinkedIn Signal Monitor API step-by-step. No coding experience needed - just follow along!

## 📦 What You're Building

An automated system that:
- Watches LinkedIn profiles for specific keywords
- Sends you alerts when those keywords appear
- Runs 24/7 in the cloud
- Handles paid subscriptions automatically

## ⏱️ Time Required

- **First time setup**: 2-3 hours
- **After you know it**: 30 minutes

## 🎒 What You Need

### Software to Install
1. **Node.js** - Download from [nodejs.org](https://nodejs.org/) (get the LTS version)
2. **VS Code** - Download from [code.visualstudio.com](https://code.visualstudio.com/)
3. **Git** - Already installed ✓

### Accounts to Create (All Free to Start)
1. **Supabase** - Your database ([supabase.com](https://supabase.com))
2. **Apify** - LinkedIn scraping ([apify.com](https://apify.com))
3. **Lemon Squeezy** - Payment processing ([lemonsqueezy.com](https://lemonsqueezy.com))
4. **Railway** - Hosting ([railway.app](https://railway.app))

---

## 📝 Step-by-Step Instructions

### STEP 1: Install Node.js

1. Go to [nodejs.org](https://nodejs.org/)
2. Download the **LTS version** (left button)
3. Run the installer
4. Keep clicking "Next" with default settings
5. Verify it worked:
   - Open Terminal (Mac) or Command Prompt (Windows)
   - Type: `node --version`
   - You should see something like `v18.17.0`

### STEP 2: Open Your Project

1. Open **VS Code**
2. Click **File → Open Folder**
3. Select the `linkedin-signal-monitor` folder
4. Click "Open"

You should now see all the project files on the left side!

### STEP 3: Install Dependencies

1. In VS Code, click **Terminal → New Terminal** (or press Ctrl+`)
2. A terminal will open at the bottom
3. Type this command and press Enter:
   ```bash
   npm install
   ```
4. Wait 1-2 minutes while it downloads everything
5. When it's done, you'll see your cursor again

### STEP 4: Set Up Supabase (Database)

#### Create Project
1. Go to [supabase.com](https://supabase.com)
2. Click **"Start your project"**
3. Sign up with GitHub or email
4. Click **"New Project"**
5. Fill in:
   - **Name**: linkedin-monitor
   - **Database Password**: Create a strong password (save it!)
   - **Region**: Choose closest to you
6. Click **"Create new project"**
7. Wait 2 minutes for it to set up

#### Get Your Database Keys
1. In your Supabase project, click **Settings** (gear icon)
2. Click **API**
3. You'll see:
   - **Project URL** - copy this
   - **anon/public key** - copy this
4. Save these somewhere - you'll need them soon!

#### Set Up Database Tables
1. In Supabase, click **SQL Editor** on the left
2. Click **"New query"**
3. Go back to VS Code
4. Open the file `schema.sql`
5. Copy EVERYTHING in that file (Ctrl+A, then Ctrl+C)
6. Go back to Supabase
7. Paste into the SQL editor (Ctrl+V)
8. Click **"Run"** (or press Ctrl+Enter)
9. You should see "Success. No rows returned"

Perfect! Your database is ready.

### STEP 5: Set Up Apify (LinkedIn Scraper)

1. Go to [apify.com](https://apify.com)
2. Click **"Sign up"**
3. After signing in, click **"Actors"** in the top menu
4. In the search box, type: `linkedin posts`
5. Look for an actor like **"LinkedIn Profile Scraper"** or **"LinkedIn Posts Scraper"**
6. Click on it
7. Copy the **Actor ID** from the URL (looks like: `apify/linkedin-profile-scraper`)
8. Click your profile icon → **Settings → Integrations**
9. Copy your **API Token** (starts with `apify_api_...`)

Save both of these!

### STEP 6: Set Up Lemon Squeezy (Payments)

#### Create Account
1. Go to [lemonsqueezy.com](https://lemonsqueezy.com)
2. Click **"Get started"**
3. Sign up and complete onboarding

#### Create Products
1. Click **Products** → **"New Product"**
2. Create your first plan:
   - **Name**: Basic Plan
   - **Price**: $29/month (or your price)
   - **Billing**: Recurring monthly
3. Click **Save**
4. Copy the **Variant ID** (a number like `12345`)
5. Repeat for Business Plan:
   - **Name**: Business Plan
   - **Price**: $99/month
   - **Billing**: Recurring monthly
6. Copy this **Variant ID** too

#### Get API Keys
1. Click **Settings** → **API**
2. Click **"Create API key"**
3. Copy the API key

#### Set Up Webhook (We'll finish this later)
1. Click **Settings** → **Webhooks**
2. Click **"+"** to add webhook
3. For now, use: `https://example.com/lemonsqueezy/webhook`
4. Select all **Subscription** events
5. Copy the **Signing secret**
6. Click **Save**

We'll update the URL after deployment!

### STEP 7: Configure Environment Variables

1. In VS Code, find the file `.env.example`
2. Right-click it → **Copy**
3. Right-click in the file explorer → **Paste**
4. Rename the copy to `.env` (just remove `.example`)
5. Open the `.env` file
6. Fill in all the values you saved:

```env
PORT=3000
NODE_ENV=production

# From Supabase
SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_KEY=paste_your_anon_key_here

# From Apify
APIFY_TOKEN=apify_api_xxxxxxxxxxxxx
APIFY_ACTOR_ID=apify/your-actor-name

# From Lemon Squeezy
LEMONSQUEEZY_API_KEY=paste_your_api_key
LEMONSQUEEZY_WEBHOOK_SECRET=paste_signing_secret
BASIC_VARIANT_ID=12345
BUSINESS_VARIANT_ID=67890
```

7. Save the file (Ctrl+S)

**IMPORTANT**: Never share this .env file - it contains your secrets!

### STEP 8: Test Locally

1. In VS Code terminal, type:
   ```bash
   npm start
   ```
2. You should see:
   ```
   ✅ Database connection verified
   ✅ Server running on port 3000
   🔄 Scheduler running - scans every hour
   ```

Success! Press Ctrl+C to stop the server.

### STEP 9: Deploy to Railway

#### Push to GitHub
1. Go to [github.com](https://github.com)
2. Click **"New repository"**
3. Name it: `linkedin-signal-monitor`
4. Make it **Private**
5. Click **"Create repository"**
6. Copy the commands under "push an existing repository"
7. In VS Code terminal, run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/repladder/linkedin-signal-monitor.git
   git push -u origin main
   ```

#### Deploy on Railway
1. Go to [railway.app](https://railway.app)
2. Click **"Start a New Project"**
3. Click **"Deploy from GitHub repo"**
4. Authorize Railway to access GitHub
5. Select your `linkedin-signal-monitor` repository
6. Railway will start building (wait 2-3 minutes)

#### Add Environment Variables
1. Click on your project in Railway
2. Click **"Variables"** tab
3. Click **"Raw Editor"**
4. Copy ALL the contents of your `.env` file
5. Paste into Railway
6. Click **"Update Variables"**
7. Railway will redeploy (wait 1 minute)

#### Get Your URL
1. Click **"Settings"** tab
2. Scroll to **"Domains"**
3. Click **"Generate Domain"**
4. Copy the URL (like `linkedin-monitor-production.up.railway.app`)

### STEP 10: Update Lemon Squeezy Webhook

1. Go back to Lemon Squeezy
2. Click **Settings** → **Webhooks**
3. Click on your webhook
4. Change URL to:
   ```
   https://YOUR-RAILWAY-URL.up.railway.app/lemonsqueezy/webhook
   ```
5. Click **Save**

### STEP 11: Create Your First User

1. Go to Supabase
2. Click **SQL Editor**
3. Click **"New query"**
4. Paste this (use YOUR email):
   ```sql
   INSERT INTO users (email, plan) 
   VALUES ('your-email@example.com', 'free')
   RETURNING *;
   ```
5. Click **Run**
6. Copy the `api_key` from the results (starts with `lsm_`)

**Save this API key** - you'll use it to access your API!

### STEP 12: Test Your Live API

1. Open a new terminal
2. Test the health check (replace YOUR-URL):
   ```bash
   curl https://YOUR-RAILWAY-URL.up.railway.app/health
   ```
3. You should get:
   ```json
   {"status":"ok","timestamp":"..."}
   ```

4. Test creating a profile (replace YOUR-API-KEY):
   ```bash
   curl -X POST https://YOUR-RAILWAY-URL.up.railway.app/profiles \
     -H "Authorization: Bearer YOUR-API-KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "linkedin_url": "https://www.linkedin.com/in/test",
       "keywords": ["hiring"]
     }'
   ```

If you get a success response - **YOU'RE DONE!** 🎉

---

## 🎯 What Happens Now?

Your system is running 24/7:
1. Every hour, it checks LinkedIn profiles
2. If it finds your keywords, it saves an event
3. If you set up a webhook, it sends you an alert
4. All events are stored in your database

## 📱 Next Steps

### Set Up Webhooks (Optional)
To get real-time alerts:
1. Use a service like [Zapier](https://zapier.com) or [Make](https://make.com)
2. Create a webhook URL
3. Send it to your API:
   ```bash
   curl -X POST https://YOUR-URL/webhook \
     -H "Authorization: Bearer YOUR-API-KEY" \
     -H "Content-Type: application/json" \
     -d '{"webhook_url": "YOUR-WEBHOOK-URL"}'
   ```

### Monitor Your System
- **Railway Logs**: Click "Logs" tab to see what's happening
- **Check Events**: Visit your API docs (API.md) for all endpoints
- **Supabase Dashboard**: View your database directly

### Add More Profiles
Use the API (see API.md) or tools like Postman/Insomnia to manage profiles.

---

## 🆘 Troubleshooting

### "npm: command not found"
- Node.js isn't installed correctly
- Restart your terminal and try again
- Reinstall Node.js

### "Database connection failed"
- Check your `SUPABASE_URL` and `SUPABASE_KEY` in .env
- Make sure you ran the schema.sql in Supabase

### "Deployment failed on Railway"
- Check the logs in Railway dashboard
- Verify all environment variables are set
- Make sure you pushed latest code to GitHub

### "No events detected"
- Wait for the hourly scan to run
- Check Railway logs for errors
- Verify keywords are spelled correctly
- Make sure profile has recent posts

---

## 💰 Costs

**Monthly Costs**:
- Supabase: Free (up to 500MB database)
- Apify: Free credits, then ~$0.10-0.50 per profile scan
- Railway: ~$10-20/month
- Lemon Squeezy: 5% + $0.50 per transaction

**Total to start**: ~$10-20/month

---

## 🎉 Congratulations!

You've just built and deployed your first SaaS application!

Your LinkedIn Signal Monitor is now:
- ✅ Running in the cloud
- ✅ Monitoring profiles 24/7
- ✅ Ready to accept payments
- ✅ Sending alerts automatically

**What you built**:
- A REST API with authentication
- Automated background jobs
- Database integration
- Payment processing
- Webhook notifications

That's seriously impressive for a non-coder! 🚀

---

## 📚 Learn More

- **API Documentation**: See `API.md` for all endpoints
- **Deployment Guide**: See `DEPLOYMENT.md` for advanced deployment
- **Main README**: See `README.md` for technical details

**Questions?** Review the logs in Railway - they'll show you exactly what's happening!
