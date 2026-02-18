const express = require('express');
const { supabase } = require('../utils/db');
const logger = require('../utils/logger');
const { authenticateApiKey } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /events
 * Get events for authenticated user's profiles
 */
router.get('/', authenticateApiKey, async (req, res) => {
  try {
    const { since, limit = 50 } = req.query;

    // Build query
    let query = supabase
      .from('events')
      .select(`
        id,
        keyword,
        post_url,
        post_date,
        snippet,
        detected_at,
        profiles!inner(
          id,
          linkedin_url,
          user_id
        )
      `)
      .eq('profiles.user_id', req.user.id)
      .order('detected_at', { ascending: false })
      .limit(parseInt(limit));

    // Optional: filter by timestamp
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        query = query.gte('detected_at', sinceDate.toISOString());
      }
    }

    const { data: events, error } = await query;

    if (error) {
      logger.error('Failed to fetch events', error);
      return res.status(500).json({ error: 'Failed to fetch events' });
    }

    // Transform response to cleaner format
    const cleanEvents = events.map(event => ({
      id: event.id,
      keyword: event.keyword,
      post_url: event.post_url,
      post_date: event.post_date,
      snippet: event.snippet,
      detected_at: event.detected_at,
      profile: {
        id: event.profiles.id,
        linkedin_url: event.profiles.linkedin_url
      }
    }));

    res.json({
      success: true,
      count: cleanEvents.length,
      events: cleanEvents
    });

  } catch (error) {
    logger.error('Error fetching events', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /events/stats
 * Get event statistics for the user
 */
router.get('/stats', authenticateApiKey, async (req, res) => {
  try {
    // Get total events count
    const { count: totalEvents, error: countError } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('profiles.user_id', req.user.id);

    if (countError) {
      logger.error('Failed to count events', countError);
      return res.status(500).json({ error: 'Failed to fetch statistics' });
    }

    // Get events in last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { count: recentEvents, error: recentError } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('profiles.user_id', req.user.id)
      .gte('detected_at', sevenDaysAgo.toISOString());

    if (recentError) {
      logger.error('Failed to count recent events', recentError);
    }

    res.json({
      success: true,
      stats: {
        total_events: totalEvents || 0,
        events_last_7_days: recentEvents || 0
      }
    });

  } catch (error) {
    logger.error('Error fetching event stats', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
