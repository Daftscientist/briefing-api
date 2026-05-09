import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { consumeBriefing } from './store.js';
import { getDb } from './db.js';

getDb();

const app = new Hono();

app.use('*', cors({
  origin: ['https://daft.onl', 'https://www.daft.onl'],
  maxAge: 86400,
}));

app.get('/health', (c) => c.json({ status: 'ok', version: '1.0.0' }));

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

// Everything else 404
app.all('*', (c) => c.json({ error: 'Not found' }, 404));

const port = parseInt(process.env.PORT || '3001');
serve({ port, fetch: app.fetch }, () => {
  console.log(`Public briefing API running on port ${port}`);
});
