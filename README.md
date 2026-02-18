# LinkedIn Signal Monitor API

A production-ready backend SaaS that monitors LinkedIn profiles for keyword mentions and sends real-time alerts.

## 🎯 Features

- **Profile Monitoring**: Track up to 10,000 LinkedIn profiles
- **Keyword Detection**: Get notified when keywords appear in posts
- **Webhook Alerts**: Real-time notifications via HTTP webhooks
- **Subscription Plans**: Free, Basic, and Business tiers
- **Automated Scanning**: Hourly background jobs
- **API-First**: Clean REST API for integration

## 🏗️ Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: Supabase (PostgreSQL)
- **Scraping**: Apify API
- **Payments**: Lemon Squeezy
- **Scheduling**: node-cron

## 📋 Prerequisites

Before you begin, ensure you have:

1. **Node.js 18+** installed ([Download here](https://nodejs.org/))
2. **Git** installed
3. **Code editor** (VS Code recommended)

You'll also need accounts for:
- [Supabase](https://supabase.com) - Database (free tier available)
- [Apify](https://apify.com) - LinkedIn scraping (free credits available)
- [Lemon Squeezy](https://lemonsqueezy.com) - Payment processing

## 🚀 Quick Start

### 1. Clone and Install

```bash
# Clone the repository (or extract the ZIP)
cd linkedin-signal-monitor

# Install dependencies
npm install
```

### 2. Set Up Supabase Database

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** in your Supabase dashboard
3. Click **New Query**
4. Copy and paste the contents of `schema.sql`
5. Click **Run** to create all tables

### 3. Configure Apify

1. Sign up at [apify.com](https://apify.com)
2. Search the Apify Store for "LinkedIn posts" or "LinkedIn profile scraper"
3. Choose an actor (e.g., "LinkedIn Posts Scraper")
4. Note the **Actor ID** from the URL (e.g., `apify/linkedin-posts-scraper`)
5. Get your **API Token** from Settings → Integrations

### 4. Set Up Lemon Squeezy

1. Create account at [lemonsqueezy.com](https://lemonsqueezy.com)
2. Create two products:
   - **Basic Plan** - Set your price (e.g., $29/month)
   - **Business Plan** - Set your price (e.g., $99/month)
3. Get your **API Key** from Settings → API
4. Get **Variant IDs** for each product
5. Set up a webhook:
   - Go to Settings → Webhooks
   - URL: `https://your-domain.com/lemonsqueezy/webhook`
   - Events: Select all subscription events
   - Copy the **Signing Secret**

### 5. Configure Environment Variables

```bash
# Copy the example file
cp .env.example .env

# Edit .env with your values
nano .env
```

Fill in all values:

```env
PORT=3000
NODE_ENV=production

# From Supabase Project Settings → API
SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_KEY=your_supabase_anon_key

# From Apify
APIFY_TOKEN=your_apify_token
APIFY_ACTOR_ID=apify/your-chosen-actor

# From Lemon Squeezy
LEMONSQUEEZY_API_KEY=your_api_key
LEMONSQUEEZY_WEBHOOK_SECRET=your_webhook_secret
BASIC_VARIANT_ID=12345
BUSINESS_VARIANT_ID=67890
```

### 6. Test the Setup

```bash
# Verify database connection
npm run setup-db

# Start the server
npm start
```

You should see:
```
✅ Database connection verified
✅ Server running on port 3000
🔄 Scheduler running - scans every hour
```

### 7. Create Your First User

Run this SQL in Supabase SQL Editor:

```sql
INSERT INTO users (email, plan) 
VALUES ('your-email@example.com', 'free')
RETURNING *;
```

Copy the `api_key` from the result - you'll use this to authenticate API requests.

## 📡 API Usage

### Authentication

All requests require an API key in the Authorization header:

```bash
Authorization: Bearer lsm_your_api_key_here
```

### Create a Profile to Monitor

```bash
curl -X POST http://localhost:3000/profiles \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "linkedin_url": "https://www.linkedin.com/in/johndoe",
    "keywords": ["hiring", "job opening", "we are looking for"]
  }'
```

### Get Your Events

```bash
curl http://localhost:3000/events \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Configure Webhook

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook_url": "https://your-domain.com/receive-signals"
  }'
```

### Full API Documentation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /profiles` | POST | Add profile to monitor |
| `GET /profiles` | GET | List all your profiles |
| `PATCH /profiles/:id` | PATCH | Update keywords |
| `DELETE /profiles/:id` | DELETE | Remove profile |
| `GET /events` | GET | Get detected signals |
| `GET /events/stats` | GET | Get statistics |
| `POST /webhook` | POST | Set webhook URL |
| `DELETE /webhook` | DELETE | Remove webhook |
| `POST /scan-now` | POST | Trigger immediate scan |

## 🔄 How It Works

1. **You add profiles** with keywords to monitor
2. **Every hour**, the scheduler:
   - Finds profiles due for scanning
   - Sends them to Apify for scraping
   - Gets latest 3 posts per profile
   - Checks for keyword matches
   - Stores events in database
   - Sends webhook notifications
3. **You receive alerts** when keywords are detected

## 📊 Subscription Plans

| Plan | Profiles | Scan Frequency | Price |
|------|----------|----------------|-------|
| **Free** | 200 | Every 48 hours | $0 |
| **Basic** | 1,000 | Every 24 hours | Your pricing |
| **Business** | 10,000 | Every 24 hours | Your pricing |

## 🚢 Deployment

### Option A: Railway (Easiest)

1. Push your code to GitHub
2. Go to [railway.app](https://railway.app)
3. Click "New Project" → "Deploy from GitHub"
4. Select your repository
5. Add all environment variables
6. Deploy!

Railway will provide a URL like `https://your-app.up.railway.app`

### Option B: DigitalOcean Droplet

```bash
# SSH into your droplet
ssh root@your_droplet_ip

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Clone your code
git clone your_repo_url
cd linkedin-signal-monitor

# Install dependencies
npm install

# Set up environment
nano .env
# (paste your environment variables)

# Install PM2 for process management
npm install -g pm2

# Start the app
pm2 start src/server.js --name linkedin-monitor

# Set PM2 to restart on reboot
pm2 startup
pm2 save
```

## 🛠️ Development

```bash
# Install dev dependencies
npm install

# Run in development mode with auto-reload
npm run dev
```

## 📝 Project Structure

```
linkedin-signal-monitor/
├── src/
│   ├── routes/          # API endpoints
│   │   ├── profiles.js  # Profile management
│   │   ├── events.js    # Event retrieval
│   │   ├── billing.js   # Webhook config & manual scan
│   │   └── webhook.js   # Lemon Squeezy webhooks
│   ├── services/        # Business logic
│   │   ├── apify.js     # Apify integration
│   │   ├── scheduler.js # Background scanning
│   │   └── matching.js  # Keyword matching
│   ├── middleware/      # Auth & validation
│   │   └── auth.js      # API key authentication
│   ├── utils/           # Helpers
│   │   ├── db.js        # Database connection
│   │   └── logger.js    # Logging
│   └── server.js        # Main application
├── scripts/
│   └── setup-database.js # DB setup helper
├── schema.sql           # Database schema
├── package.json
└── .env.example
```

## 🔍 Troubleshooting

### Database Connection Failed
- Verify `SUPABASE_URL` and `SUPABASE_KEY` in `.env`
- Make sure you ran `schema.sql` in Supabase SQL Editor

### Apify Scan Fails
- Check your Apify actor ID is correct
- Verify your Apify token is valid
- Make sure you have credits in Apify account
- Try a different LinkedIn scraper actor

### No Events Detected
- Check if keywords are spelled correctly (matching is case-insensitive)
- Verify the profile has recent posts
- Try running a manual scan: `POST /scan-now`
- Check scheduler logs

### Webhooks Not Received
- Verify webhook URL is accessible from internet
- Check webhook URL is correct in database
- Look for errors in server logs

## 🔐 Security Notes

- Never commit `.env` file to Git
- Keep your API keys secure
- Use HTTPS in production
- Regularly rotate API keys
- Set up rate limiting in production

## 📞 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review server logs for error messages
3. Verify all environment variables are set correctly

## 📄 License

MIT License - feel free to use for your own projects!

---

Built with ❤️ for monitoring LinkedIn signals
