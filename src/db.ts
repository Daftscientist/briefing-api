import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'briefings.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS briefings (
      id TEXT PRIMARY KEY,
      tier TEXT NOT NULL CHECK(tier IN ('BRIEFING', 'URGENT', 'WARNING', 'INFO')),
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      token_consumed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      consumed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_briefings_token ON briefings(token);
    CREATE INDEX IF NOT EXISTS idx_briefings_created ON briefings(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_briefings_tier ON briefings(tier);
  `);
}

export function close(): void {
  if (db) db.close();
}
