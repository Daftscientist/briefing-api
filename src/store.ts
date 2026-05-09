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

  db.prepare(`
    INSERT INTO briefings (id, tier, summary, body, token)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.tier, input.summary, JSON.stringify(input.body), token);

  return { id, token };
}

export function consumeBriefing(token: string): Briefing | null {
  const db = getDb();
  
  const briefing = db.prepare(`
    SELECT * FROM briefings WHERE token = ? AND token_consumed = 0
  `).get(token) as Briefing | undefined;

  if (!briefing) return null;

  db.prepare(`
    UPDATE briefings SET token_consumed = 1, consumed_at = datetime('now')
    WHERE id = ?
  `).run(briefing.id);

  return briefing;
}

export function listBriefings(page: number = 1, limit: number = 20, tag?: string): {
  briefings: Briefing[];
  total: number;
  page: number;
  totalPages: number;
} {
  const db = getDb();
  
  let whereClause = '';
  const params: unknown[] = [];
  
  if (tag) {
    whereClause = 'WHERE tier = ?';
    params.push(tag);
  }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM briefings ${whereClause}`).get(...params) as { count: number }).count;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;

  const briefings = db.prepare(`
    SELECT * FROM briefings ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Briefing[];

  return { briefings, total, page, totalPages };
}

export function getLatestBriefing(): Briefing | null {
  const db = getDb();
  const briefing = db.prepare(`
    SELECT * FROM briefings ORDER BY created_at DESC LIMIT 1
  `).get() as Briefing | undefined;
  
  return briefing || null;
}
