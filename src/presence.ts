import fs from 'fs';
import path from 'path';

// ── Config ──────────────────────────────────────────────────
const STALE_LIMITS: Record<string, number> = {
  phone: 5,
  pc: 3,
  google_tv: 10,
  fire_tv: 10,
  bedroom_lamp: 30,
};

const ALLOWED_STATES = [
  'active', 'idle', 'locked', 'offline', 'unknown',
  'screen_on', 'screen_off', 'playing_media',
  'light_on', 'light_off',
];

const MAX_REPORTS = 3;
const DATA_PATH = process.env.PRESENCE_DATA || '/app/data/presence.json';

// ── Types ───────────────────────────────────────────────────
export interface Report {
  device_id: string;
  state: string;
  reported_at: string;
  last_interaction_at?: string;
  sequence?: number;
  metadata?: Record<string, unknown>;
  received_at: string;
}

interface DeviceData {
  reports: Report[];
}

type DataStore = Record<string, DeviceData>;

export interface CurrentPresence {
  overall_state: string;
  latest_interaction_at: string | null;
  devices: Record<string, {
    current_state: string;
    last_reported_at: string;
    last_interaction_at?: string;
  }>;
}

// ── Auth keys ───────────────────────────────────────────────
let deviceKeys: Record<string, string> = {};
try {
  let raw = '';
try { raw = Buffer.from(process.env.DEVICE_KEYS_B64 || '', 'base64').toString(); } catch {}
try { deviceKeys = JSON.parse(raw || '{}'); } catch {}
} catch {}

export function resolveDeviceFromKey(authKey: string): string | null {
  for (const [device, key] of Object.entries(deviceKeys)) {
    if (key === authKey) return device;
  }
  return null;
}

// ── Data access ─────────────────────────────────────────────
function loadData(): DataStore {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveData(data: DataStore): void {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// ── Validation ──────────────────────────────────────────────
export function validateReport(body: any): string | null {
  if (!body.device_id || typeof body.device_id !== 'string') return 'Missing device_id';
  if (!body.state || typeof body.state !== 'string') return 'Missing state';
  if (!ALLOWED_STATES.includes(body.state)) return `Invalid state: ${body.state}`;
  
  
  const ts = new Date(body.reported_at).getTime();
  if (isNaN(ts)) body.reported_at = new Date().toISOString();
  if (ts > Date.now() + 120000) body.reported_at = new Date().toISOString();
  
  return null;
}

// ── Report handling ─────────────────────────────────────────
export function processReport(device: string, body: any): Report {
  const data = loadData();
  if (!data[device]) data[device] = { reports: [] };

  const report: Report = {
    device_id: body.device_id,
    state: body.state,
    reported_at: body.reported_at,
    last_interaction_at: body.last_interaction_at || undefined,
    sequence: body.sequence || undefined,
    metadata: body.metadata || undefined,
    received_at: new Date().toISOString(),
  };

  // Reject older sequence
  if (body.sequence !== undefined) {
    const existing = data[device].reports[0];
    if (existing && existing.sequence !== undefined && body.sequence <= existing.sequence) {
      throw new Error(`Sequence ${body.sequence} <= latest ${existing.sequence}`);
    }
  }

  // Add to front, keep latest MAX_REPORTS
  data[device].reports.unshift(report);
  data[device].reports = data[device].reports.slice(0, MAX_REPORTS);

  saveData(data);
  return report;
}

// ── Current presence ────────────────────────────────────────
export function getCurrentPresence(): CurrentPresence {
  const data = loadData();
  const now = Date.now();
  let overall = 'unknown';
  let latestInteraction: string | null = null;
  const devices: CurrentPresence['devices'] = {};

  for (const [device, deviceData] of Object.entries(data)) {
    if (deviceData.reports.length === 0) continue;
    
    const latest = deviceData.reports[0];
    const reportedAt = new Date(latest.reported_at).getTime();
    const staleMinutes = STALE_LIMITS[device] || 10;
    const isStale = (now - reportedAt) > staleMinutes * 60 * 1000;

    let currentState = isStale ? 'unknown' : latest.state;

    // Track latest interaction
    const interactionTime = latest.last_interaction_at || latest.reported_at;
    if (!latestInteraction || interactionTime > latestInteraction) {
      latestInteraction = interactionTime;
    }

    // Determine overall state
    if (!isStale && ['active', 'screen_on', 'playing_media'].includes(latest.state)) {
      if (overall === 'unknown' || overall === 'probably_asleep') overall = 'active';
    }

    devices[device] = {
      current_state: currentState,
      last_reported_at: latest.reported_at,
      last_interaction_at: latest.last_interaction_at || undefined,
    };
  }

  // Determine if probably idle or asleep
  if (latestInteraction) {
    const lastActive = new Date(latestInteraction).getTime();
    const idleMinutes = (now - lastActive) / 60000;
    if (overall === 'unknown' && idleMinutes > 10) overall = 'probably_idle';
    if (overall === 'unknown' && idleMinutes > 45) overall = 'probably_asleep';
  }

  return {
    overall_state: overall,
    latest_interaction_at: latestInteraction,
    devices,
  };
}

// ── Cleanup for rate limiting ───────────────────────────────
const recentReports: Map<string, number[]> = new Map();
const RATE_LIMIT_WINDOW = 10000; // 10 seconds
const RATE_LIMIT_MAX = 5;

export function checkRateLimit(device: string): boolean {
  const now = Date.now();
  const timestamps = recentReports.get(device) || [];
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  recentReports.set(device, recent);
  return true;
}
