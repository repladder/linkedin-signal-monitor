const apifyService = require('./apify');
const logger = require('../utils/logger');

class EngagersService {
  /**
   * Scan post engagers and enrich their profiles
   * @param {string} postUrl - LinkedIn post URL
   * @param {string[]} engagementTypes - Array of engagement types to scrape
   * @param {number} limitPerType - Max engagers to scrape per type
   * @param {function} onProgress - Progress callback
   * @returns {object} { engagers: [], uniqueProfiles: number, csv: string }
   */
  async scanPostEngagers(postUrl, engagementTypes, limitPerType, onProgress) {
    logger.info('Starting post engagers scan', { postUrl, engagementTypes, limitPerType });

    const allEngagers = [];
    let reactionsScraped = 0;
    let commentsScraped = 0;
    let profilesEnriched = 0;

    try {
      // Step 1: Scrape reactions if requested
      const reactionTypes = engagementTypes.filter(t => t !== 'comment');
      if (reactionTypes.length > 0) {
        logger.info('Scraping reactions', { types: reactionTypes, limit: limitPerType });
        
        const reactions = await apifyService.scrapePostReactions(postUrl, limitPerType);
        reactionsScraped = reactions.length;
        
        allEngagers.push(...reactions.map(r => ({
          linkedin_url: r.profileUrl,
          reaction_type: r.reactionType
        })));

        onProgress?.({
          reactions_scraped: reactionsScraped,
          comments_scraped: 0,
          profiles_enriched: 0,
          total: reactionsScraped
        });

        logger.info('Reactions scraped', { count: reactionsScraped });
      }

      // Step 2: Scrape comments if requested
      if (engagementTypes.includes('comment')) {
        logger.info('Scraping comments', { limit: limitPerType });
        
        const comments = await apifyService.scrapePostComments(postUrl, limitPerType);
        commentsScraped = comments.length;
        
        allEngagers.push(...comments.map(c => ({
          linkedin_url: c.authorProfileUrl,
          reaction_type: 'comment',
          comment_text: c.text
        })));

        onProgress?.({
          reactions_scraped: reactionsScraped,
          comments_scraped: commentsScraped,
          profiles_enriched: 0,
          total: reactionsScraped + commentsScraped
        });

        logger.info('Comments scraped', { count: commentsScraped });
      }

      // Step 3: Deduplicate by profile URL
      const uniqueEngagers = this._deduplicateEngagers(allEngagers);
      logger.info('Deduplicated engagers', { 
        total: allEngagers.length,
        unique: uniqueEngagers.length,
        duplicates: allEngagers.length - uniqueEngagers.length
      });

      // Step 4: Enrich profiles (up to limit)
      const engagersToEnrich = uniqueEngagers.slice(0, limitPerType);
      const enrichedEngagers = [];

      for (let i = 0; i < engagersToEnrich.length; i++) {
        const engager = engagersToEnrich[i];
        
        try {
          logger.info(`Enriching profile ${i + 1}/${engagersToEnrich.length}`, { 
            profileUrl: engager.linkedin_url 
          });

          const profileData = await apifyService.enrichProfile(engager.linkedin_url);
          
          enrichedEngagers.push({
            name: profileData.fullName || 'Unknown',
            reaction_type: engager.reaction_type,
            title: profileData.headline || '',
            company: profileData.company || '',
            location: profileData.location || '',
            linkedin_url: engager.linkedin_url,
            comment_text: engager.comment_text || null
          });

          profilesEnriched++;

          // Update progress
          onProgress?.({
            reactions_scraped: reactionsScraped,
            comments_scraped: commentsScraped,
            profiles_enriched: profilesEnriched,
            total: reactionsScraped + commentsScraped
          });

        } catch (error) {
          logger.error('Error enriching profile', {
            profileUrl: engager.linkedin_url,
            error: error.message
          });

          // Add with minimal data if enrichment fails
          enrichedEngagers.push({
            name: 'Unknown',
            reaction_type: engager.reaction_type,
            title: '',
            company: '',
            location: '',
            linkedin_url: engager.linkedin_url,
            comment_text: engager.comment_text || null
          });

          profilesEnriched++;
        }
      }

      // Step 5: Generate CSV
      const csv = this._generateCSV(enrichedEngagers);

      logger.info('Scan completed successfully', {
        totalEngagers: enrichedEngagers.length,
        uniqueProfiles: uniqueEngagers.length
      });

      return {
        engagers: enrichedEngagers,
        uniqueProfiles: uniqueEngagers.length,
        csv
      };

    } catch (error) {
      logger.error('Error in scanPostEngagers', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Deduplicate engagers by LinkedIn URL
   * If same person has multiple reactions, merge them
   */
  _deduplicateEngagers(engagers) {
    const seen = new Map();

    for (const engager of engagers) {
      const key = engager.linkedin_url.toLowerCase().trim();

      if (!seen.has(key)) {
        seen.set(key, engager);
      } else {
        // Merge reaction types
        const existing = seen.get(key);
        if (!existing.reaction_type.includes(engager.reaction_type)) {
          existing.reaction_type += `, ${engager.reaction_type}`;
        }
        // Keep comment text if exists
        if (engager.comment_text && !existing.comment_text) {
          existing.comment_text = engager.comment_text;
        }
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Generate CSV from enriched engagers
   */
  _generateCSV(engagers) {
    const headers = ['Name', 'Reaction Type', 'Title', 'Company', 'Location', 'LinkedIn URL'];
    const rows = engagers.map(e => [
      this._escapeCsvValue(e.name),
      this._escapeCsvValue(e.reaction_type),
      this._escapeCsvValue(e.title),
      this._escapeCsvValue(e.company),
      this._escapeCsvValue(e.location),
      e.linkedin_url
    ]);

    const csvLines = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ];

    return csvLines.join('\n');
  }

  /**
   * Escape CSV values (handle commas, quotes, newlines)
   */
  _escapeCsvValue(value) {
    if (!value) return '';
    
    const stringValue = String(value);
    
    // If value contains comma, quote, or newline, wrap in quotes and escape quotes
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
  }
}

module.exports = new EngagersService();
