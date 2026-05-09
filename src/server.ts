import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createBriefing, consumeBriefing, listBriefings, getLatestBriefing } from './store.js';
import { getDb } from './db.js';

// Initialize database on startup
getDb();

const app = new Hono();

// CORS for daft.onl
app.use('*', cors({
  origin: ['https://daft.onl', 'https://www.daft.onl'],
  maxAge: 86400,
}));

// Auth middleware for write operations
function requireAuth(c: any, next: any) {
  const authKey = c.req.header('x-api-key');
  const expectedKey = process.env.API_KEY;
  
  if (!expectedKey || authKey !== expectedKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
}

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', version: '1.0.0' });
});

// Create a briefing (authenticated)
app.post('/api/briefings', requireAuth, async (c) => {
  try {
    const body = await c.req.json();
    
    if (!body.tier || !body.summary) {
      return c.json({ error: 'Missing required fields: tier, summary' }, 400);
    }
    
    if (!['BRIEFING', 'URGENT', 'WARNING', 'INFO'].includes(body.tier)) {
      return c.json({ error: 'Invalid tier. Must be BRIEFING, URGENT, WARNING, or INFO' }, 400);
    }

    const result = createBriefing({
      tier: body.tier,
      summary: body.summary,
      body: body.body || {},
    });

    return c.json(result, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Consume a briefing by token (one-time link)
app.get('/api/briefing/:token', (c) => {
  const token = c.req.param('token');
  
  if (!token || token.split('-').length !== 7) {
    return c.json({ error: 'Invalid token format' }, 400);
  }

  const briefing = consumeBriefing(token);
  
  if (!briefing) {
    return c.json({ error: 'Briefing not found or already viewed' }, 404);
  }

  return c.json({
    id: briefing.id,
    tier: briefing.tier,
    summary: briefing.summary,
    body: JSON.parse(briefing.body),
    created_at: briefing.created_at,
  });
});

// List briefings (paginated)
app.get('/api/briefings', (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const tag = c.req.query('tag');

  if (page < 1) return c.json({ error: 'Invalid page' }, 400);
  if (limit < 1 || limit > 100) return c.json({ error: 'Invalid limit (1-100)' }, 400);

  const result = listBriefings(page, limit, tag);
  
  return c.json(result);
});

// Get latest briefing
app.get('/api/briefings/latest', (c) => {
  const briefing = getLatestBriefing();
  if (!briefing) {
    return c.json({ error: 'No briefings yet' }, 404);
  }
  return c.json({
    id: briefing.id,
    tier: briefing.tier,
    summary: briefing.summary,
    body: JSON.parse(briefing.body),
    created_at: briefing.created_at,
  });
});

// Live service status (for daft.onl table)
app.get('/api/status', async (c) => {
  return c.json({
    version: '1.0.0',
    generated_at: new Date().toISOString(),
  });
});

const port = parseInt(process.env.PORT || '3001');

serve({
  port,
  fetch: app.fetch,
}, (info) => {
  console.log(`Briefing API running on port ${port}`);
});

export default app;
