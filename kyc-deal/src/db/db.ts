/** SQLite handle + tiny helpers. One local file, WAL mode, foreign keys on. */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { config } from '../config.js';
import { initSchema } from './schema.js';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = path.dirname(config.dbPath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  _db = db;
  return _db;
}

/** Tests: swap in an in-memory database. */
export function setDb(db: Database.Database): void {
  initSchema(db);
  _db = db;
}

let counter = 0;
export function genId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
