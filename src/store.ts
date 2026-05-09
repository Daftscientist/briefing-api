import { getDb } from './db.js';
import { generateToken } from './token.js';

export interface Briefing {
  id: string;
  tier: 'BRIEFING' | 'URGENT' | 'WARNING' | 'INFO';
  summary: string;
  body: string;
  token: string;
  created_at: string;
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

export function getBriefing(token: string): Briefing | null {
  const db = getDb();
  const briefing = db.prepare(
    'SELECT * FROM briefings WHERE token = ?'
  ).get(token) as Briefing | undefined;

  if (!briefing) return null;

  // Check 12h expiry from creation
  const created = new Date(briefing.created_at + 'Z').getTime();
  const now = Date.now();
  if (now - created > 12 * 60 * 60 * 1000) {
    return null;
  }

  return briefing;
}
