const apifyService = require('./apify');
const logger = require('../utils/logger');

class EngagersService {
  /**
   * HYBRID APPROACH with ROBUST ERROR HANDLING
   */
  async scanPostEngagers(postUrl, engagementTypes, limitPerType, onProgress) {
    logger.info('Starting HYBRID enrichment scan', { postUrl, engagementTypes, limitPerType });

    const allEngagers = [];
    let reactionsScraped = 0;
    let commentsScraped = 0;
    let profilesEnriched = 0;
    let companiesEnriched = 0;

    try {
      // PHASE 1: SCRAPE ENGAGEMENTS
      const reactionTypes = engagementTypes.filter(t => t !== 'comment');
      
      if (reactionTypes.length > 0) {
        logger.info('Scraping reactions', { types: reactionTypes, limit: limitPerType });
        
        const reactions = await apifyService.scrapePostReactions(postUrl, limitPerType);
        reactionsScraped = reactions.length;
        
        // ADDED: Filter out invalid profiles
        allEngagers.push(...reactions
          .filter(r => r.profileUrl && r.profileUrl.trim())  // ← SAFETY CHECK
          .map(r => ({
            linkedin_url: r.profileUrl,
            reaction_type: r.reactionType || 'Like',  // ← DEFAULT VALUE
            comment_text: null
          }))
        );

        onProgress?.({
          reactions_scraped: reactionsScraped,
          comments_scraped: 0,
          profiles_enriched: 0,
          companies_enriched: 0,
          total: reactionsScraped
        });

        logger.info('Reactions scraped', { count: reactionsScraped, valid: allEngagers.length });
      }

      if (engagementTypes.includes('comment')) {
        logger.info('Scraping comments', { limit: limitPerType });
        
        const comments = await apifyService.scrapePostComments(postUrl, limitPerType);
        commentsScraped = comments.length;
        
        // ADDED: Filter out invalid profiles
        allEngagers.push(...comments
          .filter(c => c.profileUrl && c.profileUrl.trim())  // ← SAFETY CHECK
          .map(c => ({
            linkedin_url: c.profileUrl,
            reaction_type: 'Comment',
            comment_text: c.commentText || ''
          }))
        );

        onProgress?.({
          reactions_scraped: reactionsScraped,
          comments_scraped: commentsScraped,
          profiles_enriched: 0,
          companies_enriched: 0,
          total: reactionsScraped + commentsScraped
        });

        logger.info('Comments scraped', { count: commentsScraped });
      }

      // Deduplicate with SAFE error handling
      const uniqueEngagers = this._deduplicateEngagers(allEngagers);
      logger.info('Deduplicated engagers', { 
        total: allEngagers.length,
        unique: uniqueEngagers.length,
        duplicates: allEngagers.length - uniqueEngagers.length
      });

      // PHASE 2: ENRICH PROFILES
      const engagersToEnrich = uniqueEngagers.slice(0, limitPerType);
      const profileEnrichedData = [];

      const BATCH_SIZE = 10;
      const DELAY_BETWEEN_BATCHES = 2000;

      logger.info('Starting PARALLEL profile enrichment', {
        totalProfiles: engagersToEnrich.length,
        batchSize: BATCH_SIZE
      });

      const profileBatches = this._chunkArray(engagersToEnrich, BATCH_SIZE);

      for (let batchIndex = 0; batchIndex < profileBatches.length; batchIndex++) {
        const batch = profileBatches[batchIndex];

        const batchPromises = batch.map(async (engager) => {
          try {
            const enrichedData = await apifyService.enrichProfile(engager.linkedin_url);
            
            return {
              success: true,
              engager: engager,
              profileData: enrichedData
            };
          } catch (error) {
            logger.error('Error enriching profile', {
              profileUrl: engager.linkedin_url,
              error: error.message
            });
            
            return {
              success: false,
              engager: engager,
              profileData: null
            };
          }
        });

        const batchResults = await Promise.allSettled(batchPromises);

        batchResults.forEach((result) => {
          if (result.status === 'fulfilled' && result.value.success) {
            profileEnrichedData.push(result.value);
            profilesEnriched++;
          }
        });

        onProgress?.({
          reactions_scraped: reactionsScraped,
          comments_scraped: commentsScraped,
          profiles_enriched: profilesEnriched,
          companies_enriched: 0,
          total: reactionsScraped + commentsScraped
        });

        if (batchIndex < profileBatches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        }
      }

      logger.info('Profile enrichment complete', { 
        profilesEnriched,
        total: engagersToEnrich.length 
      });

      // PHASE 3: SELECTIVE COMPANY ENRICHMENT
      const uniqueCompanies = this._extractUniqueCompanies(profileEnrichedData);
      
      logger.info('Starting SELECTIVE company enrichment', {
        totalCompanies: uniqueCompanies.length
      });

      const companyDataMap = new Map();

      if (uniqueCompanies.length > 0) {
        const companyBatches = this._chunkArray(uniqueCompanies, BATCH_SIZE);

        for (let batchIndex = 0; batchIndex < companyBatches.length; batchIndex++) {
          const batch = companyBatches[batchIndex];

          const batchPromises = batch.map(async (companyUrl) => {
            try {
              const companyData = await apifyService.enrichCompany(companyUrl);
              return {
                success: true,
                companyUrl,
                companyData
              };
            } catch (error) {
              logger.error('Error enriching company', {
                companyUrl,
                error: error.message
              });
              return {
                success: false,
                companyUrl,
                companyData: null
              };
            }
          });

          const batchResults = await Promise.allSettled(batchPromises);

          batchResults.forEach((result) => {
            if (result.status === 'fulfilled' && result.value.success) {
              companyDataMap.set(result.value.companyUrl, result.value.companyData);
              companiesEnriched++;
            }
          });

          onProgress?.({
            reactions_scraped: reactionsScraped,
            comments_scraped: commentsScraped,
            profiles_enriched: profilesEnriched,
            companies_enriched: companiesEnriched,
            total: reactionsScraped + commentsScraped
          });

          if (batchIndex < companyBatches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
          }
        }
      }

      logger.info('Company enrichment complete', {
        companiesEnriched,
        total: uniqueCompanies.length
      });

      // PHASE 4: COMBINE ALL DATA
      const fullyEnrichedEngagers = profileEnrichedData.map(({ engager, profileData }) => {
        let companyData = {
          industry: '',
          employeeSize: '',
          companyLocation: ''
        };

        if (profileData?.needsCompanyEnrichment && profileData.companyLinkedinUrl) {
          const enrichedCompany = companyDataMap.get(profileData.companyLinkedinUrl);
          if (enrichedCompany) {
            companyData = enrichedCompany;
          }
        }

        return {
          name: profileData?.fullName || 'Unknown',
          job_title: profileData?.jobTitle || '',
          location: profileData?.location || '',
          linkedin_url: profileData?.linkedinUrl || engager.linkedin_url,
          total_connections: profileData?.connectionsCount || 0,
          follower_count: profileData?.followerCount || 0,
          company_name: profileData?.companyName || '',
          industry: companyData.industry || '',
          employee_size: companyData.employeeSize || '',
          company_location: companyData.companyLocation || '',
          company_profile_url: profileData?.companyLinkedinUrl || '',
          reaction_type: engager.reaction_type,
          comment_text: engager.comment_text || null
        };
      });

      const csv = this._generateCSV(fullyEnrichedEngagers);

      logger.info('HYBRID enrichment scan completed', {
        totalEngagers: fullyEnrichedEngagers.length,
        uniqueProfiles: uniqueEngagers.length,
        profilesEnriched: profilesEnriched,
        companiesEnriched: companiesEnriched
      });

      return {
        engagers: fullyEnrichedEngagers,
        uniqueProfiles: uniqueEngagers.length,
        profilesEnriched: fullyEnrichedEngagers.length,
        companiesEnriched: companiesEnriched,
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
   * Extract unique company URLs
   * @private
   */
  _extractUniqueCompanies(profileEnrichedData) {
    const companyUrls = new Set();
    
    profileEnrichedData.forEach(({ profileData }) => {
      if (profileData?.needsCompanyEnrichment && profileData.companyLinkedinUrl) {
        companyUrls.add(profileData.companyLinkedinUrl);
      }
    });

    return Array.from(companyUrls);
  }

  /**
   * Split array into chunks
   * @private
   */
  _chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Deduplicate engagers - SAFE VERSION
   * @private
   */
  _deduplicateEngagers(engagers) {
    const seen = new Map();

    for (const engager of engagers) {
      // ADDED: Skip if no URL
      if (!engager.linkedin_url) {
        logger.warn('Skipping engager with no URL', { engager });
        continue;
      }

      try {
        const normalizedUrl = engager.linkedin_url
          .split('?')[0]
          .replace(/\/$/, '')
          .toLowerCase()
          .trim();

        if (!seen.has(normalizedUrl)) {
          seen.set(normalizedUrl, {
            ...engager,
            linkedin_url: engager.linkedin_url,
            reaction_type: engager.reaction_type || 'Unknown'  // ← DEFAULT VALUE
          });
        } else {
          const existing = seen.get(normalizedUrl);
          
          // ADDED: Safe split with fallback
          const existingTypes = (existing.reaction_type || 'Unknown').split(', ');
          const newType = engager.reaction_type || 'Unknown';
          
          if (!existingTypes.includes(newType)) {
            existing.reaction_type = [...existingTypes, newType].join(', ');
          }
          
          if (engager.comment_text && !existing.comment_text) {
            existing.comment_text = engager.comment_text;
          }
        }
      } catch (error) {
        logger.error('Error deduplicating engager', {
          error: error.message,
          engager: engager
        });
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Generate CSV with ALL 11 fields
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
      'Company Location',
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
      this._escapeCsvValue(e.company_location),
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
   * Escape CSV values
   */
  _escapeCsvValue(value) {
    if (!value) return '';
    
    const stringValue = String(value);
    
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
  }
}

module.exports = new EngagersService();
