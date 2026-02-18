const { supabase } = require('../utils/db');
const logger = require('../utils/logger');

// Plan limits
const PLAN_LIMITS = {
  free: 200,
  basic: 1000,
  business: 10000
};

async function authenticateApiKey(req, res, next) {
  try {
    // Extract API key from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Missing or invalid Authorization header. Use: Authorization: Bearer YOUR_API_KEY' 
      });
    }

    const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Lookup user by API key
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('api_key', apiKey)
      .single();

    if (error || !user) {
      logger.warn('Invalid API key attempt', { apiKey: apiKey.substring(0, 10) + '...' });
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Attach user to request object
    req.user = user;
    req.planLimit = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;

    next();
  } catch (error) {
    logger.error('Authentication error', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

module.exports = {
  authenticateApiKey,
  PLAN_LIMITS
};
