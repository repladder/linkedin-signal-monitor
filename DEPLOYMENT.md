  # Deployment Guide

This guide covers deploying your LinkedIn Signal Monitor API to production.

## 🎯 Pre-Deployment Checklist

Before deploying, ensure you have:

- ✅ All environment variables ready
- ✅ Database schema run in Supabase
- ✅ Tested locally with `npm start`
- ✅ Apify actor working correctly
- ✅ Lemon Squeezy products created
- ✅ Code pushed to GitHub (recommended)

## 🚀 Railway Deployment (Recommended for Beginners)

Railway is the easiest option - no server management needed!

### Step 1: Prepare Your Repository

```bash
# Initialize git (if not already done)
git init
git add .
git commit -m "Initial commit"

# Push to GitHub
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

### Step 2: Deploy to Railway

1. Go to [railway.app](https://railway.app)
2. Sign in with GitHub
3. Click **"New Project"**
4. Select **"Deploy from GitHub repo"**
5. Choose your `linkedin-signal-monitor` repository
6. Railway will detect it's a Node.js app

### Step 3: Configure Environment Variables

In Railway dashboard:

1. Click on your project
2. Go to **Variables** tab
3. Add all environment variables from your `.env` file:

```
PORT=3000
NODE_ENV=production
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=your_key
APIFY_TOKEN=your_token
APIFY_ACTOR_ID=apify/actor-id
LEMONSQUEEZY_API_KEY=your_key
LEMONSQUEEZY_WEBHOOK_SECRET=your_secret
BASIC_VARIANT_ID=12345
BUSINESS_VARIANT_ID=67890
```

### Step 4: Deploy

1. Click **"Deploy"**
2. Wait for build to complete (2-3 minutes)
3. Railway will provide a URL like: `https://linkedin-signal-monitor-production.up.railway.app`

### Step 5: Verify Deployment

```bash
# Test health check
curl https://your-railway-url.up.railway.app/health

# Should return:
{"status":"ok","timestamp":"...","service":"linkedin-signal-monitor-api"}
```

### Step 6: Update Lemon Squeezy Webhook

1. Go to Lemon Squeezy → Settings → Webhooks
2. Update webhook URL to:
   ```
   https://your-railway-url.up.railway.app/lemonsqueezy/webhook
   ```

### Railway Tips

- **Logs**: Click "Logs" tab to see real-time server output
- **Metrics**: View CPU, memory usage in "Metrics" tab
- **Cost**: First $5/month free, then ~$10-20/month
- **Auto-Deploy**: Pushes to GitHub trigger automatic deploys

---

## 🖥️ DigitalOcean Droplet Deployment

For more control and potentially lower cost at scale.

### Step 1: Create Droplet

1. Go to [digitalocean.com](https://digitalocean.com)
2. Create → Droplets
3. Choose:
   - **Image**: Ubuntu 22.04 LTS
   - **Size**: Basic ($6/month droplet is sufficient to start)
   - **Datacenter**: Closest to your users
   - **Authentication**: SSH key (recommended) or password
4. Click **Create Droplet**
5. Note your droplet's IP address

### Step 2: Connect to Droplet

```bash
# SSH into your server
ssh root@YOUR_DROPLET_IP
```

### Step 3: Install Node.js

```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Verify installation
node --version  # Should show v18.x.x
npm --version
```

### Step 4: Install Git and Clone Code

```bash
# Install git
apt install git -y

# Clone your repository
cd /opt
git clone https://github.com/yourusername/linkedin-signal-monitor.git
cd linkedin-signal-monitor

# Install dependencies
npm install --production
```

### Step 5: Configure Environment

```bash
# Create .env file
nano .env
```

Paste your environment variables:

```env
PORT=3000
NODE_ENV=production
SUPABASE_URL=your_url
SUPABASE_KEY=your_key
APIFY_TOKEN=your_token
APIFY_ACTOR_ID=your_actor
LEMONSQUEEZY_API_KEY=your_key
LEMONSQUEEZY_WEBHOOK_SECRET=your_secret
BASIC_VARIANT_ID=12345
BUSINESS_VARIANT_ID=67890
```

Save with `Ctrl+X`, then `Y`, then `Enter`.

### Step 6: Install PM2 Process Manager

```bash
# Install PM2 globally
npm install -g pm2

# Start the application
pm2 start src/server.js --name linkedin-monitor

# View logs
pm2 logs linkedin-monitor

# Set PM2 to start on server reboot
pm2 startup
pm2 save
```

### Step 7: Set Up Nginx Reverse Proxy

```bash
# Install Nginx
apt install nginx -y

# Create Nginx configuration
nano /etc/nginx/sites-available/linkedin-monitor
```

Paste this configuration:

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Enable the site:

```bash
# Create symbolic link
ln -s /etc/nginx/sites-available/linkedin-monitor /etc/nginx/sites-enabled/

# Test configuration
nginx -t

# Restart Nginx
systemctl restart nginx
```

### Step 8: Set Up SSL with Let's Encrypt (Optional but Recommended)

```bash
# Install Certbot
apt install certbot python3-certbot-nginx -y

# Get SSL certificate
certbot --nginx -d your-domain.com

# Certbot will automatically configure HTTPS
```

### Step 9: Configure Firewall

```bash
# Allow SSH, HTTP, and HTTPS
ufw allow 22
ufw allow 80
ufw allow 443

# Enable firewall
ufw enable
```

### Step 10: Verify Deployment

```bash
# Test locally
curl http://localhost:3000/health

# Test externally
curl http://YOUR_DOMAIN_OR_IP/health
```

### DigitalOcean Management Commands

```bash
# View application logs
pm2 logs linkedin-monitor

# Restart application
pm2 restart linkedin-monitor

# Stop application
pm2 stop linkedin-monitor

# View application status
pm2 status

# Update code from GitHub
cd /opt/linkedin-signal-monitor
git pull
npm install --production
pm2 restart linkedin-monitor
```

---

## 🔄 Post-Deployment Steps

### 1. Create Your First User

Go to Supabase SQL Editor and run:

```sql
INSERT INTO users (email, plan) 
VALUES ('your-email@example.com', 'free')
RETURNING *;
```

Save the `api_key` returned.

### 2. Test the API

```bash
# Replace with your actual API key and domain
export API_KEY="lsm_your_api_key"
export API_URL="https://your-domain.com"

# Test creating a profile
curl -X POST $API_URL/profiles \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "linkedin_url": "https://www.linkedin.com/in/test-profile",
    "keywords": ["hiring"]
  }'

# Test getting profiles
curl $API_URL/profiles \
  -H "Authorization: Bearer $API_KEY"
```

### 3. Monitor the Scheduler

Check logs to ensure the scheduler is running:

```bash
# Railway: Check "Logs" tab in dashboard

# DigitalOcean:
pm2 logs linkedin-monitor
```

You should see messages like:
```
✅ Scheduler started - will run every hour
=== Starting scheduled scan ===
```

### 4. Set Up Monitoring (Optional)

Consider adding:
- **Uptime monitoring**: [UptimeRobot](https://uptimerobot.com) (free)
- **Error tracking**: [Sentry](https://sentry.io) (free tier available)
- **Log management**: Built-in JSON logs are production-ready

---

## 🐛 Debugging Production Issues

### Check Logs

**Railway:**
- Click "Logs" tab in dashboard
- Filter by time or search keywords

**DigitalOcean:**
```bash
# Live logs
pm2 logs linkedin-monitor

# Last 100 lines
pm2 logs linkedin-monitor --lines 100

# Error logs only
pm2 logs linkedin-monitor --err
```

### Common Issues

**Scheduler not running:**
```bash
# Check if process is running
pm2 status

# Restart if needed
pm2 restart linkedin-monitor
```

**Database connection errors:**
- Verify `SUPABASE_URL` and `SUPABASE_KEY`
- Check Supabase dashboard for any issues
- Ensure schema was run successfully

**Apify errors:**
- Check Apify dashboard for remaining credits
- Verify actor ID is correct
- Try different LinkedIn scraper actor

### Health Monitoring Script

Create a simple health check:

```bash
#!/bin/bash
# save as check-health.sh

curl -f https://your-domain.com/health || pm2 restart linkedin-monitor
```

Add to crontab:
```bash
# Run every 5 minutes
crontab -e

# Add this line:
*/5 * * * * /path/to/check-health.sh
```

---

## 💰 Cost Estimates

### Railway
- **Free tier**: $5/month credit
- **Typical cost**: $10-20/month
- **Scaling**: Automatic

### DigitalOcean
- **Droplet**: $6/month (1GB RAM)
- **Scaling**: Manual (upgrade droplet size)
- **Total**: ~$6-12/month

### Third-Party Services
- **Supabase**: Free tier (500MB database, 50MB file storage)
- **Apify**: Free credits available, then pay-per-use
- **Lemon Squeezy**: 5% + $0.50 per transaction

---

## 🎉 You're Live!

Your LinkedIn Signal Monitor API is now deployed and running 24/7!

Next steps:
1. Share API documentation with your users
2. Set up your Lemon Squeezy payment links
3. Start monitoring LinkedIn profiles
4. Scale as you grow

Need help? Check the main README.md or review the logs for error messages.
