import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createBriefing, consumeBriefing, listBriefings, getLatestBriefing } from './store.js';
import { getDb } from './db.js';

getDb();

const app = new Hono();

app.use('*', cors({
  origin: ['https://daft.onl', 'https://www.daft.onl'],
  maxAge: 86400,
}));

// Require tailscale gateway auth for protected routes
function requireTailscaleAuth(c: any, next: any) {
  const auth = c.req.header('x-tailscale-authenticated');
  if (auth !== 'true') {
    return c.json({ error: 'Only accessible via Tailscale network' }, 403);
  }
  return next();
}

function requireWriteKey(c: any, next: any) {
  const authKey = c.req.header('x-api-key');
  const expectedKey = process.env.API_KEY;
  if (!expectedKey || authKey !== expectedKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
}

// Public
app.get('/health', (c) => c.json({ status: 'ok', version: '1.0.0' }));

app.get('/api/briefing/:token', (c) => {
  const token = c.req.param('token');
  if (!token || token.split('-').length !== 7) {
    return c.json({ error: 'Invalid token format' }, 400);
  }
  const briefing = consumeBriefing(token);
  if (!briefing) return c.json({ error: 'Briefing not found or already viewed' }, 404);
  return c.json({
    id: briefing.id, tier: briefing.tier, summary: briefing.summary,
    body: JSON.parse(briefing.body), created_at: briefing.created_at,
  });
});

// Tailscale-only
app.get('/api/ping', (c) => {
  return c.json({ onTailscale: true, user: 'tailnet-authenticated' });
});

app.post('/api/briefings', requireWriteKey, async (c) => {
  try {
    const body = await c.req.json();
    if (!body.tier || !body.summary) return c.json({ error: 'Missing fields' }, 400);
    if (!['BRIEFING','URGENT','WARNING','INFO'].includes(body.tier)) return c.json({ error: 'Invalid tier' }, 400);
    const result = createBriefing({ tier: body.tier, summary: body.summary, body: body.body || {} });
    return c.json(result, 201);
  } catch (err: any) { return c.json({ error: err.message }, 500); }
});

app.get('/api/briefings', requireTailscaleAuth, (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const tag = c.req.query('tag');
  if (page < 1) return c.json({ error: 'Invalid page' }, 400);
  if (limit < 1 || limit > 100) return c.json({ error: 'Invalid limit' }, 400);
  return c.json(listBriefings(page, limit, tag));
});

app.get('/api/briefings/latest', requireTailscaleAuth, (c) => {
  const briefing = getLatestBriefing();
  if (!briefing) return c.json({ error: 'No briefings yet' }, 404);
  return c.json({
    id: briefing.id, tier: briefing.tier, summary: briefing.summary,
    body: JSON.parse(briefing.body), created_at: briefing.created_at,
  });
});

app.get('/api/status', requireTailscaleAuth, async (c) => {
  return c.json({ version: '1.0.0', generated_at: new Date().toISOString() });
});

app.all('*', (c) => c.json({ error: 'Not found' }, 404));

const port = parseInt(process.env.PORT || '3002');
serve({ port, fetch: app.fetch }, () => {
  console.log(`Internal briefing API running on port ${port}`);
});
