import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getBriefing, createBriefing } from './store.js';
import { getDb } from './db.js';
import { runFullPoll, analyzeSleep, pollTV } from './poller.js';

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



// SmartThings lifecycle handler (PING verification)
// Store confirmation URL in memory
let pendingConfirmationUrl: string | null = null;
export function getConfirmationUrl(): string | null { return pendingConfirmationUrl; }

app.post('/auth/smartthings', async (c) => {
  try {
    const body = await c.req.json();
    
    // Handle CONFIRMATION event (sent after apps:register)
    if (body.messageType === 'CONFIRMATION' && body.confirmationData?.confirmationUrl) {
      pendingConfirmationUrl = body.confirmationData.confirmationUrl;
      console.log('[smartthings] CONFIRMATION URL:', pendingConfirmationUrl);
      return c.json({ statusCode: 200 });
    }
    
    // Handle PING lifecycle event
    const lifecycle = body.lifecycle || body.evt;
    if (lifecycle === 'PING') {
      return c.json({ statusCode: 200, lifecycle: 'PONG' });
    }
    
    return c.json({ statusCode: 200 });
  } catch {
    return c.json({ statusCode: 200 });
  }
});

app.get('/auth/smartthings/confirm', (c) => {
  const url = pendingConfirmationUrl || 'Not yet received. Run smartthings apps:register to trigger.';
  return c.text('Confirmation URL: ' + url + '\n\nCopy this URL into your browser, or run it from the CLI.');
});

app.get('/auth/smartthings', async (c) => {

  const clientId = process.env.ST_CLIENT_ID;
  if (!clientId) return c.text('ST OAuth not configured', 500);

  // Generate PKCE verifier and challenge
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  const verifier = btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const challengeBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBuf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  const authUrl = 'https://api.smartthings.com/oauth/authorize?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: 'https://api.daft.onl/auth/smartthings/callback',
    response_type: 'code',
    scope: 'r:devices:*',
    state: verifier,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    client_type: 'LOCATION',
    location_id: 'b1544ec2-a403-4c39-b9c5-780e6739f9e0',
  });
  
  return c.redirect(authUrl);
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


// ── API Poller (called by cron) ────────────────────────────
app.post('/api/poll', async (c) => {
  const results = await runFullPoll();
  return c.json(results);
});

// ── Sleep analysis ─────────────────────────────────────────
app.get('/api/analysis/sleep', async (c) => {
  const presRes = await fetch('https://api.daft.onl/presence/current');
  const presence = await presRes.json() as any;
  return c.json(analyzeSleep(presence));
});

// ── TV state check (separate from full poll) ───────────────
app.post('/api/poll/tv', async (c) => {
  await pollTV();
  return c.json({ ok: true });
});

app.all('*', (c) => c.json({ error: 'Not found' }, 404));

const port = parseInt(process.env.PORT || '3001');
serve({ port, fetch: app.fetch }, () => {
  console.log(`Briefing API running on port ${port}`);
});

// Auto-poll TV state every 5 minutes
const FIVE_MIN = 5 * 60 * 1000;
setInterval(async () => {
  try {
    const info = await pollTV();
    console.log('[auto] TV poll completed');
  } catch (e: any) {
    console.log('[auto] TV poll failed:', e?.message);
  }
}, FIVE_MIN);
// Also poll immediately on startup (with delay for server to be ready)
setTimeout(() => pollTV().catch(() => {}), 5000);
