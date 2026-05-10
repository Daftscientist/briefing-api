import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getBriefing, createBriefing } from './store.js';
import { getDb } from './db.js';

getDb();

const app = new Hono();

app.use('*', cors({
  origin: ['https://daft.onl', 'https://www.daft.onl'],
  maxAge: 86400,
}));

app.get('/health', (c) => c.json({ status: 'ok', version: '1.0.0' }));

// One-time briefing link — consumed after view, expires after 12h
app.get('/api/briefing/:token', (c) => {
  const token = c.req.param('token');
  if (!token || token.split('-').length !== 7) {
    return c.json({ error: 'Invalid token format' }, 400);
  }
  const briefing = getBriefing(token);
  if (!briefing) {
    return c.json({ error: 'Briefing not found, already viewed, or expired' }, 404);
  }
  return c.json({
    id: briefing.id,
    tier: briefing.tier,
    summary: briefing.summary,
    body: JSON.parse(briefing.body),
    created_at: briefing.created_at,
  });
});

// Write endpoint (me from de2)
app.post('/api/briefings', async (c) => {
  const authKey = c.req.header('x-api-key');
  const expectedKey = process.env.API_KEY;
  if (!expectedKey || authKey !== expectedKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  try {
    const body = await c.req.json();
    if (!body.tier || !body.summary) return c.json({ error: 'Missing tier or summary' }, 400);
    if (!['BRIEFING','URGENT','WARNING','INFO'].includes(body.tier)) return c.json({ error: 'Invalid tier' }, 400);
    const result = createBriefing({ tier: body.tier, summary: body.summary, body: body.body || {} });
    return c.json(result, 201);
  } catch (err: any) { return c.json({ error: err.message }, 500); }
});

// Catch-all 404


// ── SmartThings OAuth ──────────────────────────────────────
app.get('/auth/smartthings/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.text('Missing code', 400);

  const clientId = process.env.ST_CLIENT_ID;
  const clientSecret = process.env.ST_CLIENT_SECRET;
  if (!clientId || !clientSecret) return c.text('ST OAuth not configured', 500);

  try {
    const params = new URLSearchParams();
    params.set('client_id', clientId);
    params.set('client_secret', clientSecret);
    params.set('code', code);
    params.set('grant_type', 'authorization_code');
    params.set('redirect_uri', 'https://api.daft.onl/auth/smartthings/callback');
    const res = await fetch('https://api.smartthings.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = await res.json();
    if (data.access_token) {
      // Save tokens to file
      const fs = await import('fs');
      fs.mkdirSync('/app/data', { recursive: true });
      fs.writeFileSync('/app/data/st-tokens.json', JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in || 86400) * 1000,
      }));
      // Report TV state
      const status = await fetch(
        'https://api.smartthings.com/v1/devices/2c0685d1-4766-44ce-84e1-8326020f4cf4/status',
        { headers: { Authorization: 'Bearer ' + data.access_token } }
      );
      const tvData = await status.json();
      const switchState = tvData?.components?.main?.switch?.switch?.value;
      const now = new Date().toISOString();
      if (switchState) {
        // POST to presence
        const presenceKey = process.env.DEVICE_KEYS ? 
          JSON.parse(process.env.DEVICE_KEYS)?.google_tv || 'none' : 'none';
        if (presenceKey !== 'none') {
          await fetch('https://api.daft.onl/presence/report/' + presenceKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              device_id: 'google_tv',
              state: switchState === 'on' ? 'playing_media' : 'idle',
              reported_at: now,
              last_interaction_at: tvData?.components?.main?.switch?.switch?.timestamp || now,
            }),
          });
        }
      }
      return c.text('✅ SmartThings authorized! TV is ' + (switchState === 'on' ? 'ON' : 'OFF'));
    }
    return c.text('Error: ' + JSON.stringify(data), 400);
  } catch (err) {
    return c.text('Error: ' + String(err), 500);
  }
});

// ── Presence tracker ───────────────────────────────────────
import { resolveDeviceFromKey, validateReport, processReport, getCurrentPresence, checkRateLimit } from './presence.js';

app.post('/presence/report/:auth_key', async (c) => {
  const authKey = c.req.param('auth_key');
  const device = resolveDeviceFromKey(authKey);
  if (!device) {
    console.log(`[presence] rejected: unknown auth key`);
    return c.json({ error: 'Unknown device key' }, 401);
  }

  if (!checkRateLimit(device)) {
    return c.json({ error: 'Rate limited' }, 429);
  }

  try {
    const body = await c.req.json();
    const validationError = validateReport(body);
    if (validationError) {
      console.log(`[presence] rejected ${device}: ${validationError}`);
      return c.json({ error: validationError }, 400);
    }
    if (body.device_id !== device) {
      console.log(`[presence] rejected ${device}: device_id mismatch (${body.device_id})`);
      return c.json({ error: 'device_id does not match auth key' }, 400);
    }
    const report = processReport(device, body);
    console.log(`[presence] accepted ${device}: ${body.state}`);
    return c.json({ ok: true, report });
  } catch (err: any) {
    console.log(`[presence] rejected ${device}: ${err.message}`);
    return c.json({ error: err.message }, 400);
  }
});

app.get('/presence/current', (c) => {
  const presence = getCurrentPresence();
  return c.json(presence);
});

app.all('*', (c) => c.json({ error: 'Not found' }, 404));

const port = parseInt(process.env.PORT || '3001');
serve({ port, fetch: app.fetch }, () => {
  console.log(`Briefing API running on port ${port}`);
});
