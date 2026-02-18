const cron = require('node-cron');
const { supabase } = require('../utils/db');
const logger = require('../utils/logger');
const apifyService = require('./apify');
const matchingService = require('./matching');
const axios = require('axios');

// Scan intervals by plan (in hours)
const SCAN_INTERVALS = {
  free: 48,
  basic: 24,
  business: 24
};

const BATCH_SIZE = 200; // Process up to 200 profiles per hour

class SchedulerService {
  constructor() {
    this.isRunning = false;
    this.cronJob = null;
  }

  /**
   * Start the scheduler - runs every hour
   */
  start() {
    // Run every hour at minute 0
    this.cronJob = cron.schedule('0 * * * *', async () => {
      await this.runScan();
    });

    logger.info('✅ Scheduler started - will run every hour');
    
    // Optional: Run immediately on startup for testing
    // Uncomment the line below if you want immediate execution
    // setTimeout(() => this.runScan(), 5000);
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      logger.info('Scheduler stopped');
    }
  }

  /**
   * Main scan logic - processes profiles due for scanning
   */
  async runScan() {
    if (this.isRunning) {
      logger.warn('Scan already in progress, skipping this cycle');
      return;
    }

    this.isRunning = true;
    logger.info('=== Starting scheduled scan ===');

    try {
      // Get profiles that need scanning
      const profiles = await this._getProfilesForScanning();
      
      if (profiles.length === 0) {
        logger.info('No profiles due for scanning');
        return;
      }

      logger.info(`Processing ${profiles.length} profiles`);

      // Group profiles by user for webhook delivery
      const profilesByUser = this._groupByUser(profiles);

      // Scan all profiles via Apify
      const profileUrls = profiles.map(p => p.linkedin_url);
      const scanResults = await apifyService.scanProfiles(profileUrls);

      // Process each result
      for (const result of scanResults) {
        await this._processScanResult(result, profiles);
      }

      logger.info('=== Scheduled scan completed ===');
    } catch (error) {
      logger.error('Scheduler scan failed', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get profiles that are due for scanning
   */
  async _getProfilesForScanning() {
    const now = new Date().toISOString();

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select(`
        id,
        user_id,
        linkedin_url,
        keywords,
        last_post_timestamp,
        users!inner(plan, webhook_url)
      `)
      .lte('next_scan_at', now)
      .limit(BATCH_SIZE)
      .order('next_scan_at', { ascending: true });

    if (error) {
      logger.error('Failed to fetch profiles for scanning', error);
      return [];
    }

    return profiles || [];
  }

  /**
   * Process a single scan result from Apify
   */
  async _processScanResult(result, allProfiles) {
    try {
      // Find matching profile
      const profile = allProfiles.find(p => p.linkedin_url === result.linkedin_url);
      
      if (!profile) {
        logger.warn('No matching profile found for scan result', { url: result.linkedin_url });
        return;
      }

      const { posts } = result;

      if (!posts || posts.length === 0) {
        logger.info('No posts found for profile', { profileId: profile.id });
        await this._updateNextScan(profile);
        return;
      }

      // Get newest post date
      const latestPostDate = this._getLatestPostDate(posts);
      const lastKnownTimestamp = profile.last_post_timestamp 
        ? new Date(profile.last_post_timestamp) 
        : null;

      // Filter to only new posts
      const newPosts = posts.filter(post => {
        if (!post.post_date) return false;
        if (!lastKnownTimestamp) return true;
        return new Date(post.post_date) > lastKnownTimestamp;
      });

      if (newPosts.length === 0) {
        logger.info('No new posts since last scan', { profileId: profile.id });
        await this._updateNextScan(profile);
        return;
      }

      logger.info(`Found ${newPosts.length} new posts for profile`, { 
        profileId: profile.id 
      });

      // Process new posts for keyword matches
      const events = [];
      
      for (const post of newPosts) {
        const matchedEvents = matchingService.processPost(
          post,
          profile.keywords,
          profile.id
        );
        events.push(...matchedEvents);
      }

      // Insert events (will skip duplicates due to unique constraint)
      if (events.length > 0) {
        await this._insertEvents(events);
        
        // Send webhook if configured
        if (profile.users.webhook_url) {
          await this._sendWebhook(profile.users.webhook_url, events);
        }
      }

      // Update profile with latest timestamp and next scan time
      await this._updateProfileAfterScan(profile, latestPostDate);

    } catch (error) {
      logger.error('Failed to process scan result', error, { 
        url: result.linkedin_url 
      });
      // Continue processing other profiles
    }
  }

  /**
   * Get the latest post date from array of posts
   */
  _getLatestPostDate(posts) {
    const dates = posts
      .map(p => p.post_date)
      .filter(d => d)
      .map(d => new Date(d))
      .filter(d => !isNaN(d.getTime()));

    if (dates.length === 0) return null;

    return new Date(Math.max(...dates));
  }

  /**
   * Insert events into database
   */
  async _insertEvents(events) {
    // Insert events, ignore duplicates
    const { data, error } = await supabase
      .from('events')
      .insert(events)
      .select();

    if (error) {
      // Check if error is due to duplicate constraint
      if (error.code === '23505') {
        logger.info('Skipped duplicate events', { count: events.length });
      } else {
        logger.error('Failed to insert events', error);
      }
      return;
    }

    logger.info(`Inserted ${data?.length || 0} new events`);
  }

  /**
   * Send webhook notification
   */
  async _sendWebhook(webhookUrl, events) {
    try {
      const payload = {
        type: 'signal_detected',
        timestamp: new Date().toISOString(),
        events: events.map(e => ({
          keyword: e.keyword,
          post_url: e.post_url,
          post_date: e.post_date,
          snippet: e.snippet
        }))
      };

      await axios.post(webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });

      logger.info('Webhook sent successfully', { 
        url: webhookUrl, 
        eventCount: events.length 
      });
    } catch (error) {
      logger.error('Webhook delivery failed', error, { url: webhookUrl });
      // Don't throw - webhook failure shouldn't break the scan
    }
  }

  /**
   * Update profile with new timestamp and schedule next scan
   */
  async _updateProfileAfterScan(profile, latestPostDate) {
    const plan = profile.users.plan || 'free';
    const hoursUntilNextScan = SCAN_INTERVALS[plan] || SCAN_INTERVALS.free;
    
    const nextScanAt = new Date();
    nextScanAt.setHours(nextScanAt.getHours() + hoursUntilNextScan);

    const updates = {
      next_scan_at: nextScanAt.toISOString()
    };

    if (latestPostDate) {
      updates.last_post_timestamp = latestPostDate.toISOString();
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', profile.id);

    if (error) {
      logger.error('Failed to update profile after scan', error, { 
        profileId: profile.id 
      });
    }
  }

  /**
   * Update next scan time without changing last_post_timestamp
   */
  async _updateNextScan(profile) {
    const plan = profile.users.plan || 'free';
    const hoursUntilNextScan = SCAN_INTERVALS[plan] || SCAN_INTERVALS.free;
    
    const nextScanAt = new Date();
    nextScanAt.setHours(nextScanAt.getHours() + hoursUntilNextScan);

    const { error } = await supabase
      .from('profiles')
      .update({ next_scan_at: nextScanAt.toISOString() })
      .eq('id', profile.id);

    if (error) {
      logger.error('Failed to update next scan time', error, { 
        profileId: profile.id 
      });
    }
  }

  /**
   * Group profiles by user (for potential user-level processing)
   */
  _groupByUser(profiles) {
    const grouped = {};
    
    for (const profile of profiles) {
      if (!grouped[profile.user_id]) {
        grouped[profile.user_id] = [];
      }
      grouped[profile.user_id].push(profile);
    }

    return grouped;
  }
}

module.exports = new SchedulerService();
