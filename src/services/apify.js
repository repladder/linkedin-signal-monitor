const axios = require('axios');
const logger = require('../utils/logger');

const APIFY_API_BASE = 'https://api.apify.com/v2';
const MAX_RETRIES = 1;
const POLL_INTERVAL = 10000; // 10 seconds
const MAX_POLL_TIME = 300000; // 5 minutes timeout

class ApifyService {
  constructor() {
    this.token = process.env.APIFY_TOKEN;
    this.actorId = process.env.APIFY_ACTOR_ID;
    
    if (!this.token || !this.actorId) {
      throw new Error('APIFY_TOKEN and APIFY_ACTOR_ID must be set in environment variables');
    }
  }

  /**
   * Scan multiple LinkedIn profiles and get their latest posts
   * @param {string[]} profileUrls - Array of LinkedIn profile URLs
   * @returns {Promise<Array>} Array of profile results with posts
   */
  async scanProfiles(profileUrls) {
    if (!profileUrls || profileUrls.length === 0) {
      return [];
    }

    logger.info(`Starting Apify scan for ${profileUrls.length} profiles`);

    try {
      return await this._scanWithRetry(profileUrls);
    } catch (error) {
      logger.error('Apify scan failed after retries', error, { profileUrls });
      throw error;
    }
  }

  async _scanWithRetry(profileUrls, retryCount = 0) {
    try {
      // Start the actor run
      const runId = await this._startActorRun(profileUrls);
      
      // Poll for completion
      const runResult = await this._pollRunStatus(runId);
      
      // Fetch dataset items
      const results = await this._fetchDataset(runResult.defaultDatasetId);
      
      return this._normalizeResults(results, profileUrls);
    } catch (error) {
      // Log detailed error information in a way that actually shows up
      console.error('❌ APIFY ERROR DETAILS:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        actorId: this.actorId,
        retryCount
      });
      
      if (retryCount < MAX_RETRIES) {
        logger.warn(`Apify scan attempt ${retryCount + 1} failed, retrying...`, { error: error.message });
        await this._sleep(5000); // Wait 5 seconds before retry
        return this._scanWithRetry(profileUrls, retryCount + 1);
      }
      throw error;
    }
  }

  async _startActorRun(profileUrls) {
    // Apify API uses ~ instead of / in the endpoint URL
    const actorIdForUrl = this.actorId.replace('/', '~');
    const url = `${APIFY_API_BASE}/acts/${actorIdForUrl}/runs?token=${this.token}`;
    
    // Format specifically for harvestapi/linkedin-profile-posts actor
    const input = {
      targetUrls: profileUrls, // Actor expects array of URL strings
      maxPosts: 3,
      maxComments: 0,
      maxReactions: 0,
      includeQuotePosts: true,
      includeReposts: false,
      scrapeComments: false,
      scrapeReactions: false
    };

    const response = await axios.post(url, input, {
      headers: { 'Content-Type': 'application/json' }
    });

    logger.info('Apify actor run started', { runId: response.data.data.id });
    return response.data.data.id;
  }

  async _pollRunStatus(runId) {
    const url = `${APIFY_API_BASE}/actor-runs/${runId}?token=${this.token}`;
    const startTime = Date.now();

    while (true) {
      const response = await axios.get(url);
      const run = response.data.data;

      logger.debug('Polling run status', { runId, status: run.status });

      if (run.status === 'SUCCEEDED') {
        logger.info('Apify run succeeded', { runId });
        return run;
      }

      if (run.status === 'FAILED' || run.status === 'ABORTED' || run.status === 'TIMED-OUT') {
        throw new Error(`Apify run ${run.status.toLowerCase()}: ${runId}`);
      }

      // Check timeout
      if (Date.now() - startTime > MAX_POLL_TIME) {
        throw new Error(`Apify run timed out after ${MAX_POLL_TIME / 1000} seconds`);
      }

      // Wait before next poll
      await this._sleep(POLL_INTERVAL);
    }
  }

  async _fetchDataset(datasetId) {
    const url = `${APIFY_API_BASE}/datasets/${datasetId}/items?token=${this.token}`;
    
    const response = await axios.get(url);
    return response.data;
  }

  _normalizeResults(rawResults, requestedUrls) {
    const normalized = [];

    for (const item of rawResults) {
      // Match the result to the requested URL
      const linkedinUrl = this._findMatchingUrl(item, requestedUrls);
      
      if (!linkedinUrl) {
        logger.warn('Could not match Apify result to requested URL', { item });
        continue;
      }

      const posts = this._extractPosts(item);

      normalized.push({
        linkedin_url: linkedinUrl,
        posts
      });
    }

    return normalized;
  }

  _findMatchingUrl(item, requestedUrls) {
    // Try to find matching URL from item data
    // harvestapi returns 'profileUrl' field
    const itemUrl = item.profileUrl || item.url || item.linkedin_url;
    
    if (!itemUrl) {
      return null;
    }

    // Normalize URLs for comparison
    const normalizedItemUrl = this._normalizeLinkedInUrl(itemUrl);
    
    for (const requestedUrl of requestedUrls) {
      const normalizedRequestedUrl = this._normalizeLinkedInUrl(requestedUrl);
      
      if (normalizedItemUrl === normalizedRequestedUrl) {
        return requestedUrl; // Return original URL
      }
    }

    return null;
  }

  _normalizeLinkedInUrl(url) {
    // Remove trailing slashes, query params, etc.
    return url.toLowerCase()
      .replace(/\/$/, '')
      .replace(/\?.*$/, '')
      .replace(/https?:\/\/(www\.)?/, '');
  }

  _extractPosts(item) {
    const posts = [];
    
    // harvestapi/linkedin-profile-posts returns posts in the 'posts' array
    const postsArray = item.posts || item.activities || item.recentPosts || [];

    for (const post of postsArray.slice(0, 3)) { // Only take first 3
      const postData = {
        text: post.text || post.content || post.description || post.body || '',
        post_url: post.url || post.postUrl || post.link || post.shareUrl || '',
        post_date: this._parseDate(post.postedAt || post.date || post.postedDate || post.timestamp || post.createdAt)
      };

      // Only include if we have text and URL
      if (postData.text && postData.post_url) {
        posts.push(postData);
      }
    }

    return posts;
  }

  _parseDate(dateString) {
    if (!dateString) return null;
    
    try {
      const date = new Date(dateString);
      return isNaN(date.getTime()) ? null : date.toISOString();
    } catch (error) {
      logger.warn('Failed to parse date', { dateString });
      return null;
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new ApifyService();
