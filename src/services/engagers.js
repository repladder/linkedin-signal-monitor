const apifyService = require('./apify');
const logger = require('../utils/logger');

class EngagersService {
  /**
   * HYBRID APPROACH: Profile + Selective Company Enrichment
   * - Enriches ALL profiles (person data)
   * - Only enriches companies when profile has company URL
   * - Optimized with parallel batch processing
   * 
   * @param {string} postUrl - LinkedIn post URL
   * @param {string[]} engagementTypes - Array of engagement types
   * @param {number} limitPerType - Max engagers per type
   * @param {function} onProgress - Progress callback
   * @returns {object} Complete enriched data
   */
  async scanPostEngagers(postUrl, engagementTypes, limitPerType, onProgress) {
    logger.info('Starting HYBRID enrichment scan', { postUrl, engagementTypes, limitPerType });

    const allEngagers = [];
    let reactionsScraped = 0;
    let commentsScraped = 0;
    let profilesEnriched = 0;
    let companiesEnriched = 0;

    try {
      // ==========================================
      // PHASE 1: SCRAPE ENGAGEMENTS (Fast - 1 min)
      // ==========================================

      // Step 1A: Scrape reactions
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
          companies_enriched: 0,
          total: reactionsScraped
        });

        logger.info('Reactions scraped', { count: reactionsScraped });
      }

      // Step 1B: Scrape comments
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
          companies_enriched: 0,
          total: reactionsScraped + commentsScraped
        });

        logger.info('Comments scraped', { count: commentsScraped });
      }

      // Step 1C: Deduplicate
      const uniqueEngagers = this._deduplicateEngagers(allEngagers);
      logger.info('Deduplicated engagers', { 
        total: allEngagers.length,
        unique: uniqueEngagers.length,
        duplicates: allEngagers.length - uniqueEngagers.length
      });

      // ==========================================
      // PHASE 2: ENRICH PROFILES (Parallel - 1.5 min)
      // ==========================================

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

      // ==========================================
      // PHASE 3: SELECTIVE COMPANY ENRICHMENT (Parallel - 1 min)
      // ==========================================

      // Extract unique companies that need enrichment
      const uniqueCompanies = this._extractUniqueCompanies(profileEnrichedData);
      
      logger.info('Starting SELECTIVE company enrichment', {
        totalCompanies: uniqueCompanies.length,
        profilesWithCompany: profileEnrichedData.filter(p => p.profileData?.needsCompanyEnrichment).length
      });

      const companyDataMap = new Map();  // companyUrl → company data

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

      // ==========================================
      // PHASE 4: COMBINE ALL DATA
      // ==========================================

      const fullyEnrichedEngagers = profileEnrichedData.map(({ engager, profileData }) => {
        // Get company data if available
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
          // Personal Data (6 fields)
          name: profileData?.fullName || 'Unknown',
          job_title: profileData?.jobTitle || '',
          location: profileData?.location || '',
          linkedin_url: profileData?.linkedinUrl || engager.linkedin_url,
          total_connections: profileData?.connectionsCount || 0,
          follower_count: profileData?.followerCount || 0,
          
          // Company Data (5 fields) ← NOW INCLUDING COMPANY LOCATION
          company_name: profileData?.companyName || '',
          industry: companyData.industry || '',
          employee_size: companyData.employeeSize || '',
          company_location: companyData.companyLocation || '',  // NEW!
          company_profile_url: profileData?.companyLinkedinUrl || '',
          
          // Engagement Data
          reaction_type: engager.reaction_type,
          comment_text: engager.comment_text || null
        };
      });

      // Step 5: Generate CSV
      const csv = this._generateCSV(fullyEnrichedEngagers);

      logger.info('HYBRID enrichment scan completed', {
        totalEngagers: fullyEnrichedEngagers.length,
        uniqueProfiles: uniqueEngagers.length,
        profilesEnriched: profilesEnriched,
        companiesEnriched: companiesEnriched,
        successRate: `${Math.round((profilesEnriched / engagersToEnrich.length) * 100)}%`
      });

      return {
        engagers: fullyEnrichedEngagers,
        uniqueProfiles: uniqueEngagers.length,
        profilesEnriched: profilesEnriched,
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
   * Extract unique company URLs that need enrichment
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
   * Deduplicate engagers by LinkedIn URL
   */
  _deduplicateEngagers(engagers) {
    const seen = new Map();

    for (const engager of engagers) {
      const normalizedUrl = engager.linkedin_url
        .split('?')[0]
        .replace(/\/$/, '')
        .toLowerCase()
        .trim();

      if (!seen.has(normalizedUrl)) {
        seen.set(normalizedUrl, {
          ...engager,
          linkedin_url: engager.linkedin_url
        });
      } else {
        const existing = seen.get(normalizedUrl);
        const existingTypes = existing.reaction_type.split(', ');
        
        if (!existingTypes.includes(engager.reaction_type)) {
          existing.reaction_type = [...existingTypes, engager.reaction_type].join(', ');
        }
        
        if (engager.comment_text && !existing.comment_text) {
          existing.comment_text = engager.comment_text;
        }
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Generate CSV with ALL 11 fields (added company location)
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
      'Company Location',  // NEW!
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
      this._escapeCsvValue(e.company_location),  // NEW!
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
