import fs from 'fs';

const ST_TOKEN_PATH = '/app/data/st-tokens.json';
const PRESENCE_KEYS: Record<string, string> = {
  google_tv: 'DSIijzrGuIRFtDRbAnlM5xZ8tbuD5mc7',
};

interface STTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

// ── SmartThings token management ───────────────────────────
function loadTokens(): STTokens | null {
  try { return JSON.parse(fs.readFileSync(ST_TOKEN_PATH, 'utf-8')); } catch { return null; }
}

function saveTokens(t: STTokens) {
  fs.mkdirSync('/app/data', { recursive: true });
  fs.writeFileSync(ST_TOKEN_PATH, JSON.stringify(t));
}

async function getValidToken(): Promise<string | null> {
  let tokens = loadTokens();
  if (!tokens) {
    // Try env vars as fallback
    const rt = process.env.ST_REFRESH_TOKEN;
    const at = process.env.ST_ACCESS_TOKEN;
    if (rt && at) {
      tokens = { access_token: at, refresh_token: rt, expires_at: Date.now() + 86399000 };
      saveTokens(tokens);
    }
  }
  if (!tokens) return null;

  // Refresh if expired or close to expiring (< 1h)
  if (Date.now() > tokens.expires_at - 3600000) {
    try {
      const clientId = process.env.ST_CLIENT_ID;
      const clientSecret = process.env.ST_CLIENT_SECRET;
      if (!clientId || !clientSecret) return tokens.access_token;

      const basic = Buffer.from(clientId + ':' + clientSecret).toString('base64');
      const res = await fetch('https://api.smartthings.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + basic,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: tokens.refresh_token,
        }),
      });
      const data = await res.json();
      if (data.access_token) {
        tokens = {
          access_token: data.access_token,
          refresh_token: data.refresh_token || tokens.refresh_token,
          expires_at: Date.now() + (data.expires_in || 86400) * 1000,
        };
        saveTokens(tokens);
        console.log('[poller] SmartThings token refreshed');
      }
    } catch (e) {
      console.log('[poller] Token refresh failed:', e);
    }
  }
  return tokens.access_token;
}

// ── TV state poll ──────────────────────────────────────────
export async function pollTV(): Promise<void> {
  const token = await getValidToken();
  if (!token) return;

  try {
    const res = await fetch(
      'https://api.smartthings.com/v1/devices/2c0685d1-4766-44ce-84e1-8326020f4cf4/status',
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const data: any = await res.json();
    const switchState = data?.components?.main?.switch?.switch?.value;
    if (!switchState) return;

    const state = switchState === 'on' ? 'playing_media' : 'idle';
    const now = new Date().toISOString();
    const key = PRESENCE_KEYS.google_tv;

    await fetch('https://api.daft.onl/presence/report/' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: 'google_tv',
        state,
        reported_at: now,
        last_interaction_at: data?.components?.main?.switch?.switch?.timestamp || now,
      }),
    });
    console.log('[poller] TV:', switchState);
  } catch (e) {
    console.log('[poller] TV poll failed:', e);
  }
}

// ── YouTube last activity ──────────────────────────────────
async function pollYouTube(): Promise<void> {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken) return;

  try {
    // Get access token
    const tres = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const tdata: any = await tres.json();
    const accessToken = tdata.access_token;
    if (!accessToken) return;

    // Get YouTube subscriptions (last activity proxy)
    const yt = await fetch(
      'https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&maxResults=1&mine=true&order=date',
      { headers: { Authorization: 'Bearer ' + accessToken } }
    );
    const ytData: any = await yt.json();
    const items = ytData?.items;
    if (items?.length) {
      const ts = items[0].snippet.publishedAt;
      const key = PRESENCE_KEYS.google_tv;
      const now = new Date().toISOString();
      await fetch('https://api.daft.onl/presence/report/' + key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: 'google_tv', state: 'playing_media', reported_at: now, last_interaction_at: ts }),
      });
      console.log('[poller] YouTube activity:', ts);
    }
  } catch (e) {
    console.log('[poller] YouTube poll failed:', e);
  }
}

// ── Sleep analysis ─────────────────────────────────────────
export function analyzeSleep(presenceData: any): any {
  const devices = presenceData?.devices || {};
  const now = Date.now();
  const fortyFiveMin = 45 * 60 * 1000;

  // Get latest interaction across all devices
  let lastActive: number | null = null;
  for (const d of Object.values(devices) as any[]) {
    const ts = d.last_interaction_at || d.last_reported_at;
    if (ts) {
      const ms = new Date(ts).getTime();
      if (!lastActive || ms > lastActive) lastActive = ms;
    }
  }

  const asleep = lastActive ? (now - lastActive > fortyFiveMin) : false;
  const lastActiveTime = lastActive ? new Date(lastActive).toISOString() : null;

  return {
    state: asleep ? 'probably_asleep' : 'awake',
    last_activity_at: lastActiveTime,
    minutes_since_last_activity: lastActive ? Math.round((now - lastActive) / 60000) : null,
    devices_reporting: Object.keys(devices).length,
  };
}

// ── Main poll function ─────────────────────────────────────
export async function runFullPoll(): Promise<any> {
  const results: any = {};

  try { await pollTV(); results.tv = 'ok'; } catch { results.tv = 'error'; }
  try { await pollYouTube(); results.youtube = 'ok'; } catch { results.youtube = 'error'; }

  return results;
}
