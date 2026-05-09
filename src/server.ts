import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createBriefing, consumeBriefing, listBriefings, getLatestBriefing } from './store.js';
import { getDb } from './db.js';

getDb();

const app = new Hono();

// CORS for daft.onl
app.use('*', cors({
  origin: ['https://daft.onl', 'https://www.daft.onl'],
  maxAge: 86400,
}));

// ── Auth helpers ─────────────────────────────────────────────

// Check if request is from Tailscale (via Tailscale Serve headers)
function isOnTailscale(c: any): boolean {
  // Tailscale Serve injects these headers when proxying requests
  const user = c.req.header('tailscale-user-login');
  return !!user;
}

function requireTailscale(c: any, next: any) {
  if (!isOnTailscale(c)) {
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

// ── Endpoints ────────────────────────────────────────────────

app.get('/health', (c) => {
  return c.json({ status: 'ok', version: '1.0.0' });
});

// Ping — tells frontend if user is on tailnet
app.get('/api/ping', (c) => {
  return c.json({
    onTailscale: isOnTailscale(c),
    user: c.req.header('tailscale-user-login') || null,
    // Also expose the tailscale URL for the frontend to use
    tailscaleUrl: 'https://de1.tail53f5e9.ts.net:3001',
  });
});

// Create briefing (de2 only)
app.post('/api/briefings', requireWriteKey, async (c) => {
  try {
    const body = await c.req.json();
    if (!body.tier || !body.summary) {
      return c.json({ error: 'Missing required fields: tier, summary' }, 400);
    }
    if (!['BRIEFING', 'URGENT', 'WARNING', 'INFO'].includes(body.tier)) {
      return c.json({ error: 'Invalid tier' }, 400);
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

// One-time token — public
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

// Archive — Tailscale only
app.get('/api/briefings', requireTailscale, (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const tag = c.req.query('tag');
  if (page < 1) return c.json({ error: 'Invalid page' }, 400);
  if (limit < 1 || limit > 100) return c.json({ error: 'Invalid limit' }, 400);
  return c.json(listBriefings(page, limit, tag));
});

// Latest briefing — Tailscale only
app.get('/api/briefings/latest', requireTailscale, (c) => {
  const briefing = getLatestBriefing();
  if (!briefing) return c.json({ error: 'No briefings yet' }, 404);
  return c.json({
    id: briefing.id,
    tier: briefing.tier,
    summary: briefing.summary,
    body: JSON.parse(briefing.body),
    created_at: briefing.created_at,
  });
});

// Service status — Tailscale only
app.get('/api/status', requireTailscale, async (c) => {
  return c.json({
    version: '1.0.0',
    generated_at: new Date().toISOString(),
  });
});

const port = parseInt(process.env.PORT || '3001');
serve({ port, fetch: app.fetch }, () => {
  console.log(`Briefing API running on port ${port}`);
});
export default app;
