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

    // harvestapi returns a flat array of posts, not profiles with posts
    // Group posts by profile URL
    const postsByProfile = {};
    
    for (const post of rawResults) {
      // Extract profile URL from query or author data
      const profileUrl = post.query?.targetUrl || 
                        post.author?.linkedinUrl?.split('?')[0] ||
                        null;
      
      if (!profileUrl) continue;
      
      if (!postsByProfile[profileUrl]) {
        postsByProfile[profileUrl] = [];
      }
      
      postsByProfile[profileUrl].push(post);
    }

    // Now create normalized results for each profile
    for (const [profileUrl, posts] of Object.entries(postsByProfile)) {
      // Find matching requested URL
      const matchedUrl = this._findMatchingProfileUrl(profileUrl, requestedUrls);
      
      if (!matchedUrl) {
        logger.warn('Could not match profile URL to requested URL', { profileUrl });
        continue;
      }

      const extractedPosts = this._extractPosts(posts);

      normalized.push({
        linkedin_url: matchedUrl,
        posts: extractedPosts
      });
    }

    return normalized;
  }

  _findMatchingProfileUrl(profileUrl, requestedUrls) {
    const normalizedProfile = this._normalizeLinkedInUrl(profileUrl);
    
    for (const requestedUrl of requestedUrls) {
      const normalizedRequested = this._normalizeLinkedInUrl(requestedUrl);
      
      if (normalizedProfile === normalizedRequested) {
        return requestedUrl; // Return original URL
      }
    }
    
    return null;
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
    
    // harvestapi/linkedin-profile-posts returns posts directly in the array
    // Each item IS a post, not a container with a posts array
    const postsArray = Array.isArray(item) ? item : (item.posts || [item]);

    for (const post of postsArray.slice(0, 3)) { // Only take first 3
      const postData = {
        // harvestapi uses 'content' not 'text'
        text: post.content || post.text || post.description || post.body || '',
        // harvestapi uses 'linkedinUrl' not 'post_url'
        post_url: post.linkedinUrl || post.url || post.postUrl || post.link || post.shareUrl || '',
        // harvestapi uses nested 'postedAt.date'
        post_date: this._parseDate(
          post.postedAt?.date || 
          post.postedAt?.timestamp || 
          post.date || 
          post.postedDate || 
          post.timestamp || 
          post.createdAt
        )
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

  async _runActor(actorId, input) {
    const actorIdForUrl = actorId.replace('/', '~');
    const url = `${APIFY_API_BASE}/acts/${actorIdForUrl}/runs?token=${this.token}`;

    const response = await axios.post(url, input, {
      headers: { 'Content-Type': 'application/json' }
    });

    const runId = response.data.data.id;
    logger.info('Actor run started', { actorId, runId });

    const runResult = await this._pollRunStatus(runId);
    return await this._fetchDataset(runResult.defaultDatasetId);
  }

  async scrapePostReactions(postUrl, maxReactions = 100) {
    try {
      logger.info('Scraping post reactions', { postUrl, maxReactions });

      const items = await this._runActor('datadoping/linkedin-post-reactions-scraper-no-cookie', {
        post_urls: [postUrl],
        maxReactions,
        reactionTypes: ['LIKE', 'PRAISE', 'EMPATHY', 'APPRECIATION', 'INTEREST']
      });

      logger.info('Post reactions scraped', { count: items.length, postUrl });

      return items.map(item => ({
        profileUrl: item.profileUrl || item.profileLink || item.url,
        reactionType: this._mapReactionType(item.reactionType || item.reaction)
      }));

    } catch (error) {
      logger.error('Error scraping post reactions', { error: error.message, postUrl });
      throw new Error(`Failed to scrape reactions: ${error.message}`);
    }
  }

  async scrapePostComments(postUrl, maxComments = 100) {
    try {
      logger.info('Scraping post comments', { postUrl, maxComments });

      const items = await this._runActor('harvestapi/linkedin-post-comments', {
        startUrls: [{ url: postUrl }],
        maxComments
      });

      logger.info('Post comments scraped', { count: items.length, postUrl });

      return items.map(item => ({
        authorProfileUrl: item.authorProfileUrl || item.profileUrl,
        text: item.text || item.commentText || '',
        timestamp: item.timestamp || item.postedAt
      }));

    } catch (error) {
      logger.error('Error scraping post comments', { error: error.message, postUrl });
      throw new Error(`Failed to scrape comments: ${error.message}`);
    }
  }

  async enrichProfile(profileUrl) {
    try {
      logger.info('Enriching profile', { profileUrl });

      const items = await this._runActor('harvestapi/linkedin-profile-scraper', {
        startUrls: [{ url: profileUrl }],
        includeExperience: false,
        includeEducation: false,
        includeSkills: false
      });

      if (items.length === 0) {
        throw new Error('No profile data returned');
      }

      const profile = items[0];
      logger.info('Profile enriched', { profileUrl, name: profile.fullName });

      return {
        fullName: profile.fullName || profile.name || 'Unknown',
        headline: profile.headline || profile.title || '',
        company: profile.company || profile.currentCompany || '',
        location: profile.location || profile.geo || ''
      };

    } catch (error) {
      logger.error('Error enriching profile', { error: error.message, profileUrl });
      throw new Error(`Failed to enrich profile: ${error.message}`);
    }
  }

  _mapReactionType(reactionType) {
    const mapping = {
      'LIKE': 'Like',
      'PRAISE': 'Love',
      'EMPATHY': 'Insightful',
      'APPRECIATION': 'Celebrate',
      'INTEREST': 'Curious',
      'SUPPORT': 'Support'
    };

    const upper = String(reactionType).toUpperCase();
    return mapping[upper] || reactionType;
  }
}

module.exports = new ApifyService();
