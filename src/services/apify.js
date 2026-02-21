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
        max_reactions: maxReactions,
        post_urls: [postUrl],
        reaction_type: 'ALL'
      });

      logger.info('Post reactions scraped', { count: items.length, postUrl });

      return items.map(item => ({
        profileUrl: item.reactor?.profile_url || item.reactor_profile_url,
        reactionType: this._mapReactionType(item.reaction_type)
      }));

    } catch (error) {
      logger.error('Error scraping post reactions', { error: error.message, stack: error.stack, postUrl });
      throw new Error(`Failed to scrape reactions: ${error.message}`);
    }
  }

  async scrapePostComments(postUrl, maxComments = 100) {
    try {
      logger.info('Scraping post comments', { postUrl, maxComments });

      const items = await this._runActor('harvestapi/linkedin-post-comments', {
        maxItems: maxComments,
        postedLimit: '3months',
        posts: [postUrl],
        profileScraperMode: 'short',
        scrapeReplies: false
      });

      logger.info('Post comments scraped', { count: items.length, postUrl });

      return items.map(item => ({
        profileUrl: item.actor?.linkedinUrl || '',
        commentText: item.commentary || ''
      }));

    } catch (error) {
      logger.error('Error scraping post comments', { error: error.message, stack: error.stack, postUrl });
      throw new Error(`Failed to scrape comments: ${error.message}`);
    }
  }

  async enrichProfile(profileUrl) {
    try {
      logger.info('Enriching profile', { profileUrl });

      const items = await this._runActor('harvestapi/linkedin-profile-scraper', {
        profileScraperMode: 'Profile details no email ($4 per 1k)',
        queries: [profileUrl]
      });

      if (items.length === 0) {
        throw new Error('No profile data returned');
      }

      const profile = items[0];

      let jobTitle = '';
      let companyName = '';
      let companyUrl = '';
      let companyId = null;

      // PRIORITY 1: experience array has correct slug-format URLs
      if (profile.experience && profile.experience.length > 0) {
        const currentRole = profile.experience[0];
        jobTitle = currentRole.position || profile.headline || '';
        companyName = currentRole.companyName || '';
        companyUrl = currentRole.companyLinkedinUrl || '';
        companyId = currentRole.companyId || null;

        logger.info('Extracted company from experience', {
          companyName,
          companyUrl,
          format: companyUrl.includes('/company/')
            ? (companyUrl.match(/\/company\/([^\/]+)/)?.[1]?.match(/^\d+$/) ? 'ID' : 'SLUG')
            : 'UNKNOWN'
        });
      }
      // FALLBACK: currentPosition may have numeric ID instead of slug
      else if (profile.currentPosition && profile.currentPosition.length > 0) {
        const currentPos = profile.currentPosition[0];
        jobTitle = profile.headline || '';
        companyName = currentPos.companyName || '';
        companyUrl = currentPos.companyLinkedinUrl || '';
        companyId = currentPos.companyId || null;

        logger.warn('Using currentPosition fallback (may have ID instead of slug)', {
          companyName,
          companyUrl
        });
      }
      // FINAL FALLBACK
      else {
        jobTitle = profile.headline || '';
        logger.warn('No experience or currentPosition found', { profileUrl });
      }

      let location = '';
      if (profile.location) {
        location = profile.location.parsed?.text || profile.location.linkedinText || '';
      }

      // Only trigger company enrichment if URL has a slug (not a bare numeric ID)
      const hasValidCompanyUrl = companyUrl &&
        companyUrl.includes('/company/') &&
        !companyUrl.match(/\/company\/\d+\/?$/);

      logger.info('Profile enriched', {
        profileUrl,
        name: `${profile.firstName} ${profile.lastName}`,
        company: companyName,
        hasCompanyUrl: !!companyUrl,
        companyUrlFormat: hasValidCompanyUrl ? 'SLUG' : 'ID_OR_MISSING',
        willEnrichCompany: hasValidCompanyUrl
      });

      return {
        fullName: `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'Unknown',
        jobTitle,
        location,
        linkedinUrl: profile.linkedinUrl || profileUrl,
        connectionsCount: profile.connectionsCount || 0,
        followerCount: profile.followerCount || 0,
        companyName,
        companyLinkedinUrl: companyUrl,
        companyId,
        needsCompanyEnrichment: hasValidCompanyUrl
      };

    } catch (error) {
      logger.error('Error enriching profile', { error: error.message, stack: error.stack, profileUrl });

      return {
        fullName: 'Unknown',
        jobTitle: '',
        location: '',
        linkedinUrl: profileUrl,
        connectionsCount: 0,
        followerCount: 0,
        companyName: '',
        companyLinkedinUrl: '',
        companyId: null,
        needsCompanyEnrichment: false
      };
    }
  }

  async enrichCompany(companyUrl) {
    try {
      logger.info('Enriching company', { companyUrl });

      const items = await this._runActor('harvestapi/linkedin-company', {
        companiesUrls: [companyUrl]
      });

      if (items.length === 0) {
        logger.warn('No company data returned', { companyUrl });
        return this._getCompanyFallback();
      }

      const company = items[0];

      let employeeSize = '';
      if (company.staffCount) {
        employeeSize = company.staffCount;
      } else if (company.employeeCount) {
        employeeSize = this._formatEmployeeCount(company.employeeCount);
      } else if (company.companySize) {
        employeeSize = company.companySize;
      }

      let companyLocation = '';
      if (company.headquarters) {
        const hq = company.headquarters;
        if (hq.city && hq.state) {
          companyLocation = `${hq.city}, ${hq.state}`;
        } else if (hq.city && hq.country) {
          companyLocation = `${hq.city}, ${hq.country}`;
        } else if (hq.city) {
          companyLocation = hq.city;
        }
      } else if (company.location) {
        companyLocation = company.location;
      }

      logger.info('Company enriched', {
        companyUrl,
        name: company.name,
        industry: company.industry,
        location: companyLocation
      });

      return {
        industry: company.industry || company.industries?.[0] || '',
        employeeSize,
        companyLocation,
        companyName: company.name || '',
        companyLinkedinUrl: company.linkedinUrl || companyUrl
      };

    } catch (error) {
      logger.error('Error enriching company', { error: error.message, stack: error.stack, companyUrl });
      return this._getCompanyFallback();
    }
  }

  _getCompanyFallback() {
    return {
      industry: '',
      employeeSize: '',
      companyLocation: '',
      companyName: '',
      companyLinkedinUrl: ''
    };
  }

  _formatEmployeeCount(count) {
    if (!count) return '';
    const num = parseInt(count);
    if (isNaN(num)) return count;
    if (num <= 10) return '1-10 employees';
    if (num <= 50) return '11-50 employees';
    if (num <= 200) return '51-200 employees';
    if (num <= 500) return '201-500 employees';
    if (num <= 1000) return '501-1000 employees';
    if (num <= 5000) return '1001-5000 employees';
    if (num <= 10000) return '5001-10000 employees';
    return '10000+ employees';
  }

  _mapReactionType(reactionType) {
    if (!reactionType) return 'Like';
    const mapping = {
      'LIKE': 'Like',
      'PRAISE': 'Love',
      'EMPATHY': 'Insightful',
      'APPRECIATION': 'Celebrate',
      'INTEREST': 'Curious',
      'SUPPORT': 'Support',
      'FUNNY': 'Funny'
    };
    const upper = String(reactionType).toUpperCase();
    return mapping[upper] || reactionType;
  }
}

module.exports = new ApifyService();
