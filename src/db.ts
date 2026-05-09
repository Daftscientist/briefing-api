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

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS briefings (
      id TEXT PRIMARY KEY,
      tier TEXT NOT NULL CHECK(tier IN ('BRIEFING', 'URGENT', 'WARNING', 'INFO')),
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_briefings_token ON briefings(token);
  `);
}

export function close(): void { if (db) db.close(); }
