const logger = require('../utils/logger');

class MatchingService {
  /**
   * Check if post text contains any of the keywords
   * @param {string} postText - The post content
   * @param {string[]} keywords - Array of keywords to match
   * @returns {string[]} Array of matched keywords
   */
  findMatches(postText, keywords) {
    if (!postText || !keywords || keywords.length === 0) {
      return [];
    }

    const matches = [];
    
    // Normalize post text: lowercase and remove punctuation
    const normalizedText = this._normalizeText(postText);

    for (const keyword of keywords) {
      const normalizedKeyword = this._normalizeText(keyword);
      
      if (normalizedText.includes(normalizedKeyword)) {
        matches.push(keyword); // Return original keyword, not normalized
      }
    }

    return matches;
  }

  /**
   * Extract snippet from post text
   * @param {string} postText - The full post text
   * @param {number} maxLength - Maximum snippet length (default 250)
   * @returns {string} Snippet
   */
  extractSnippet(postText, maxLength = 250) {
    if (!postText) return '';
    
    if (postText.length <= maxLength) {
      return postText;
    }

    // Cut at word boundary
    const snippet = postText.substring(0, maxLength);
    const lastSpace = snippet.lastIndexOf(' ');
    
    if (lastSpace > 0) {
      return snippet.substring(0, lastSpace) + '...';
    }

    return snippet + '...';
  }

  /**
   * Normalize text for matching: lowercase and remove punctuation
   * @param {string} text
   * @returns {string} Normalized text
   */
  _normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
      .replace(/\s+/g, ' ')      // Normalize whitespace
      .trim();
  }

  /**
   * Process a post against keywords and return event data if matched
   * @param {object} post - Post object with text, url, date
   * @param {string[]} keywords - Keywords to match
   * @param {string} profileId - Profile UUID
   * @returns {array} Array of event objects (one per matched keyword)
   */
  processPost(post, keywords, profileId) {
    const matches = this.findMatches(post.text, keywords);
    
    if (matches.length === 0) {
      return [];
    }

    const snippet = this.extractSnippet(post.text);
    const events = [];

    for (const keyword of matches) {
      events.push({
        profile_id: profileId,
        keyword,
        post_url: post.post_url,
        post_date: post.post_date,
        snippet
      });
    }

    logger.info(`Found ${matches.length} keyword matches`, { 
      profileId, 
      keywords: matches,
      postUrl: post.post_url 
    });

    return events;
  }
}

module.exports = new MatchingService();
