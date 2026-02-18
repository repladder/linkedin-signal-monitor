# API Documentation

Complete API reference for LinkedIn Signal Monitor.

**Base URL**: `https://your-domain.com`

**Authentication**: All endpoints (except webhooks) require an API key in the Authorization header:

```
Authorization: Bearer YOUR_API_KEY
```

---

## 🔑 Authentication

### Get Your API Key

API keys are generated automatically when a user is created. To get your API key:

1. Run this SQL in Supabase SQL Editor:

```sql
SELECT api_key FROM users WHERE email = 'your-email@example.com';
```

2. Copy the returned `api_key` value (format: `lsm_xxxxx...`)

### Using API Key

Include in all requests:

```bash
curl https://your-domain.com/profiles \
  -H "Authorization: Bearer lsm_your_api_key_here"
```

---

## 📊 Profiles

Manage LinkedIn profiles you want to monitor.

### Create Profile

Add a new LinkedIn profile to monitor.

**Endpoint**: `POST /profiles`

**Request Body**:
```json
{
  "linkedin_url": "https://www.linkedin.com/in/username",
  "keywords": ["hiring", "job opening", "we're hiring"]
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "profile": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "linkedin_url": "https://www.linkedin.com/in/username",
    "keywords": ["hiring", "job opening", "we're hiring"],
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

**Error Responses**:
- `400`: Invalid LinkedIn URL or keywords
- `403`: Profile limit reached for your plan
- `401`: Invalid API key

**Plan Limits**:
- Free: 200 profiles
- Basic: 1,000 profiles
- Business: 10,000 profiles

**Example**:
```bash
curl -X POST https://your-domain.com/profiles \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "linkedin_url": "https://www.linkedin.com/in/johndoe",
    "keywords": ["hiring", "opportunity", "join our team"]
  }'
```

---

### List Profiles

Get all profiles you're monitoring.

**Endpoint**: `GET /profiles`

**Response** (200 OK):
```json
{
  "success": true,
  "count": 2,
  "plan_limit": 200,
  "profiles": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "linkedin_url": "https://www.linkedin.com/in/johndoe",
      "keywords": ["hiring", "opportunity"],
      "last_post_timestamp": "2024-01-14T15:30:00Z",
      "next_scan_at": "2024-01-16T15:30:00Z",
      "created_at": "2024-01-01T10:00:00Z"
    }
  ]
}
```

**Example**:
```bash
curl https://your-domain.com/profiles \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

### Update Profile Keywords

Change the keywords for an existing profile.

**Endpoint**: `PATCH /profiles/:id`

**Request Body**:
```json
{
  "keywords": ["new keyword", "another keyword"]
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "profile": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "linkedin_url": "https://www.linkedin.com/in/johndoe",
    "keywords": ["new keyword", "another keyword"],
    "updated_at": "2024-01-15T11:00:00Z"
  }
}
```

**Example**:
```bash
curl -X PATCH https://your-domain.com/profiles/PROFILE_ID \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": ["remote work", "distributed team"]
  }'
```

---

### Delete Profile

Stop monitoring a profile.

**Endpoint**: `DELETE /profiles/:id`

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Profile deleted successfully"
}
```

**Example**:
```bash
curl -X DELETE https://your-domain.com/profiles/PROFILE_ID \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## 🎯 Events

Retrieve detected keyword matches.

### Get Events

Retrieve all detected signals (keyword matches).

**Endpoint**: `GET /events`

**Query Parameters**:
- `since` (optional): ISO timestamp - only return events after this time
- `limit` (optional): Number of events to return (default: 50, max: 100)

**Response** (200 OK):
```json
{
  "success": true,
  "count": 3,
  "events": [
    {
      "id": "789e4567-e89b-12d3-a456-426614174000",
      "keyword": "hiring",
      "post_url": "https://www.linkedin.com/feed/update/urn:li:activity:123456789",
      "post_date": "2024-01-15T09:00:00Z",
      "snippet": "We're hiring! Looking for a talented engineer to join our team...",
      "detected_at": "2024-01-15T10:30:00Z",
      "profile": {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "linkedin_url": "https://www.linkedin.com/in/johndoe"
      }
    }
  ]
}
```

**Examples**:

Get all events:
```bash
curl https://your-domain.com/events \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Get events since specific date:
```bash
curl "https://your-domain.com/events?since=2024-01-14T00:00:00Z&limit=20" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

### Get Event Statistics

Get summary statistics about your events.

**Endpoint**: `GET /events/stats`

**Response** (200 OK):
```json
{
  "success": true,
  "stats": {
    "total_events": 127,
    "events_last_7_days": 12
  }
}
```

**Example**:
```bash
curl https://your-domain.com/events/stats \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## 🔔 Webhooks

Configure where to receive real-time notifications.

### Set Webhook URL

Configure a URL to receive POST requests when signals are detected.

**Endpoint**: `POST /webhook`

**Request Body**:
```json
{
  "webhook_url": "https://your-app.com/receive-signals"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Webhook URL configured successfully",
  "webhook_url": "https://your-app.com/receive-signals"
}
```

**Webhook Payload Format**:

When a signal is detected, we'll POST this to your webhook URL:

```json
{
  "type": "signal_detected",
  "timestamp": "2024-01-15T10:30:00Z",
  "events": [
    {
      "keyword": "hiring",
      "post_url": "https://www.linkedin.com/feed/update/urn:li:activity:123456789",
      "post_date": "2024-01-15T09:00:00Z",
      "snippet": "We're hiring! Looking for a talented engineer..."
    }
  ]
}
```

**Example**:
```bash
curl -X POST https://your-domain.com/webhook \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook_url": "https://hooks.zapier.com/your-webhook-id"
  }'
```

**Webhook Tips**:
- Your endpoint must return 2xx status code
- Timeout is 10 seconds
- Failed webhooks won't retry (but events are still stored)
- Works great with Zapier, Make, or custom endpoints

---

### Remove Webhook

Stop receiving webhook notifications.

**Endpoint**: `DELETE /webhook`

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Webhook URL removed"
}
```

**Example**:
```bash
curl -X DELETE https://your-domain.com/webhook \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## 🔧 Utility

### Manual Scan

Trigger an immediate scan of your profiles (useful for testing).

**Endpoint**: `POST /scan-now`

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Queued 5 profiles for immediate scanning",
  "profiles_queued": 5,
  "note": "Profiles will be scanned in the next scheduler cycle (within 1 hour)"
}
```

**Note**: 
- This sets profiles to be scanned on the next scheduler run (every hour)
- Limited to 10 profiles per request
- Useful for testing without waiting for scheduled scan

**Example**:
```bash
curl -X POST https://your-domain.com/scan-now \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

### Health Check

Check if the API is running.

**Endpoint**: `GET /health`

**Authentication**: Not required

**Response** (200 OK):
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "service": "linkedin-signal-monitor-api"
}
```

**Example**:
```bash
curl https://your-domain.com/health
```

---

## 📡 How Scanning Works

1. **You add profiles** with keywords
2. **Every hour**, the scheduler:
   - Finds profiles due for scanning (based on plan)
   - Sends them to Apify
   - Gets latest 3 posts per profile
   - Checks posts for keyword matches
   - Stores any matched events
   - Sends webhook notification (if configured)
3. **Next scan scheduled**:
   - Free plan: +48 hours
   - Basic plan: +24 hours
   - Business plan: +24 hours

### Keyword Matching Rules

- **Case insensitive**: "Hiring" matches "hiring", "HIRING", "Hiring"
- **Punctuation ignored**: "we're hiring" matches "were hiring"
- **Partial word matches**: "hire" will match "hired", "hiring", "hires"
- **Multiple keywords**: Each match creates a separate event

---

## ❌ Error Responses

All errors follow this format:

```json
{
  "error": "Error message description"
}
```

**Common HTTP Status Codes**:
- `400` - Bad Request (invalid data)
- `401` - Unauthorized (invalid or missing API key)
- `403` - Forbidden (plan limit reached)
- `404` - Not Found (resource doesn't exist)
- `500` - Internal Server Error (something went wrong)

---

## 🔒 Rate Limits

Currently no rate limits enforced. Use responsibly.

Recommended:
- Max 100 requests per minute per API key
- Max 1000 requests per hour per API key

---

## 📊 Plan Comparison

| Feature | Free | Basic | Business |
|---------|------|-------|----------|
| Profiles | 200 | 1,000 | 10,000 |
| Scan Frequency | 48 hours | 24 hours | 24 hours |
| Events Storage | Unlimited | Unlimited | Unlimited |
| Webhooks | ✅ | ✅ | ✅ |
| API Access | ✅ | ✅ | ✅ |

---

## 🎯 Example Use Cases

### Zapier Integration

1. Set webhook URL to Zapier webhook
2. When signals detected → triggers Zapier
3. Send to Slack, email, CRM, etc.

### Custom Dashboard

```javascript
// Fetch latest events every 5 minutes
setInterval(async () => {
  const response = await fetch('https://your-domain.com/events?limit=10', {
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY'
    }
  });
  const data = await response.json();
  updateDashboard(data.events);
}, 300000);
```

### Sales Lead Tracking

Monitor competitor job postings:
```bash
curl -X POST https://your-domain.com/profiles \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "linkedin_url": "https://www.linkedin.com/in/competitor-ceo",
    "keywords": ["hiring", "expansion", "new office", "funding"]
  }'
```

---

## 💡 Best Practices

1. **Keywords**: Use 3-10 keywords per profile for best results
2. **Specific keywords**: "Senior React Developer" better than "developer"
3. **Webhooks**: Always handle failures gracefully
4. **Polling**: Check `/events` endpoint rather than constant webhook reliance
5. **Testing**: Use `/scan-now` for immediate feedback during setup

---

## 🆘 Support

- Check server logs for detailed error messages
- Verify API key is correct and active
- Ensure profile limits haven't been exceeded
- Test with `/health` endpoint first

---

**Questions?** Review the main README.md or check your deployment logs.
