const apifyService = require('./apify');
const logger = require('../utils/logger');

class EngagersService {
  /**
   * Scan post engagers and FULLY enrich their profiles
   * Uses ONLY 3 Apify actors - no separate company enrichment needed!
   * 
   * @param {string} postUrl - LinkedIn post URL
   * @param {string[]} engagementTypes - Array of engagement types to scrape
   * @param {number} limitPerType - Max engagers to scrape per type
   * @param {function} onProgress - Progress callback
   * @returns {object} { engagers: [], uniqueProfiles: number, csv: string }
   */
  async scanPostEngagers(postUrl, engagementTypes, limitPerType, onProgress) {
    logger.info('Starting full enrichment scan (simplified)', { postUrl, engagementTypes, limitPerType });

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
          reaction_type: r.reactionType,
          comment_text: null
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
          linkedin_url: c.profileUrl,
          reaction_type: 'Comment',
          comment_text: c.commentText
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

      // Step 4: ENRICH ALL PROFILES (includes company data!)
      const engagersToEnrich = uniqueEngagers.slice(0, limitPerType);
      const fullyEnrichedEngagers = [];

      for (let i = 0; i < engagersToEnrich.length; i++) {
        const engager = engagersToEnrich[i];
        
        try {
          logger.info(`Enriching profile ${i + 1}/${engagersToEnrich.length}`, { 
            profileUrl: engager.linkedin_url 
          });

          // ONE API CALL gets ALL data (profile + company)
          const enrichedData = await apifyService.enrichProfile(engager.linkedin_url);
          profilesEnriched++;

          onProgress?.({
            reactions_scraped: reactionsScraped,
            comments_scraped: commentsScraped,
            profiles_enriched: profilesEnriched,
            total: reactionsScraped + commentsScraped
          });

          // All 10 fields from single enrichment
          fullyEnrichedEngagers.push({
            // Personal Data (6 fields)
            name: enrichedData.fullName || 'Unknown',
            job_title: enrichedData.jobTitle || '',
            location: enrichedData.location || '',
            linkedin_url: enrichedData.linkedinUrl || engager.linkedin_url,
            total_connections: enrichedData.connectionsCount || 0,
            follower_count: enrichedData.followerCount || 0,
            
            // Company Data (4 fields)
            company_name: enrichedData.companyName || '',
            industry: enrichedData.industry || '',
            employee_size: enrichedData.employeeSize || '',
            company_profile_url: enrichedData.companyLinkedinUrl || '',
            
            // Engagement Data
            reaction_type: engager.reaction_type,
            comment_text: engager.comment_text || null
          });

          // Rate limiting - 2 second delay between enrichments
          if (i < engagersToEnrich.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }

        } catch (error) {
          logger.error('Error enriching engager', {
            profileUrl: engager.linkedin_url,
            error: error.message
          });

          // Add with minimal data if enrichment fails
          fullyEnrichedEngagers.push({
            name: 'Unknown',
            job_title: '',
            location: '',
            linkedin_url: engager.linkedin_url,
            total_connections: 0,
            follower_count: 0,
            company_name: '',
            industry: '',
            employee_size: '',
            company_profile_url: '',
            reaction_type: engager.reaction_type,
            comment_text: engager.comment_text || null
          });

          profilesEnriched++;
        }
      }

      // Step 5: Generate CSV with ALL 10 fields
      const csv = this._generateCSV(fullyEnrichedEngagers);

      logger.info('Full enrichment scan completed', {
        totalEngagers: fullyEnrichedEngagers.length,
        uniqueProfiles: uniqueEngagers.length,
        profilesEnriched: profilesEnriched
      });

      return {
        engagers: fullyEnrichedEngagers,
        uniqueProfiles: uniqueEngagers.length,
        profilesEnriched: profilesEnriched,
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
      // Normalize URL (remove query params, trailing slash)
      const normalizedUrl = engager.linkedin_url
        .split('?')[0]
        .replace(/\/$/, '')
        .toLowerCase()
        .trim();

      if (!seen.has(normalizedUrl)) {
        seen.set(normalizedUrl, {
          ...engager,
          linkedin_url: engager.linkedin_url // Keep original URL
        });
      } else {
        // Merge reaction types
        const existing = seen.get(normalizedUrl);
        const existingTypes = existing.reaction_type.split(', ');
        
        if (!existingTypes.includes(engager.reaction_type)) {
          existing.reaction_type = [...existingTypes, engager.reaction_type].join(', ');
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
   * Generate CSV with ALL 10 fields for outbound prospecting
   */
  _generateCSV(engagers) {
    const headers = [
      'Name',
      'Job Title',
      'Location',
      'Industry',
      'LinkedIn Profile URL',
      'Total Connections',
      'Follower Count',
      'Company Name',
      'Employee Size',
      'Company Profile URL',
      'Reaction Type'
    ];
    
    const rows = engagers.map(e => [
      this._escapeCsvValue(e.name),
      this._escapeCsvValue(e.job_title),
      this._escapeCsvValue(e.location),
      this._escapeCsvValue(e.industry),
      e.linkedin_url,
      e.total_connections || 0,
      e.follower_count || 0,
      this._escapeCsvValue(e.company_name),
      this._escapeCsvValue(e.employee_size),
      e.company_profile_url || '',
      this._escapeCsvValue(e.reaction_type)
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
