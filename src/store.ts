import { getDb } from './db.js';
import { generateToken } from './token.js';

export interface Briefing {
  id: string;
  tier: 'BRIEFING' | 'URGENT' | 'WARNING' | 'INFO';
  summary: string;
  body: string;
  token: string;
  token_consumed: number;
  created_at: string;
  consumed_at: string | null;
}

export interface CreateBriefingInput {
  tier: 'BRIEFING' | 'URGENT' | 'WARNING' | 'INFO';
  summary: string;
  body: Record<string, unknown>;
}

export function createBriefing(input: CreateBriefingInput): { id: string; token: string } {
  const db = getDb();
  const id = crypto.randomUUID();
  const token = generateToken(7);
  db.prepare(
    'INSERT INTO briefings (id, tier, summary, body, token) VALUES (?, ?, ?, ?, ?)'
  ).run(id, input.tier, input.summary, JSON.stringify(input.body), token);
  return { id, token };
}

export function consumeBriefing(token: string): Briefing | null {
  const db = getDb();
  
  const briefing = db.prepare(
    'SELECT * FROM briefings WHERE token = ? AND token_consumed = 0'
  ).get(token) as Briefing | undefined;

  if (!briefing) return null;

  // Check 12h expiry
  const created = new Date(briefing.created_at + 'Z').getTime();
  const now = Date.now();
  if (now - created > 12 * 60 * 60 * 1000) {
    // Expired — mark as consumed so it can't be used
    db.prepare('UPDATE briefings SET token_consumed = 1, consumed_at = datetime(\'now\') WHERE id = ?').run(briefing.id);
    return null;
  }

  db.prepare('UPDATE briefings SET token_consumed = 1, consumed_at = datetime(\'now\') WHERE id = ?').run(briefing.id);
  return briefing;
}
