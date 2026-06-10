import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { config } from '../config.js';
import { initSchema } from './schema.js';

let _db: Database.Database | null = null;
let _inFlight = 0;

/**
 * Long, multi-stage engine operations (uploads, the drafting pipeline) hold
 * a captured db handle across awaits. Swapping workspaces mid-operation
 * closes that handle and fails the op. Bracket such operations with these so
 * a workspace switch is refused — cleanly — while one is in flight.
 */
export async function withDbOp<T>(fn: () => Promise<T>): Promise<T> {
  _inFlight += 1;
  try {
    return await fn();
  } finally {
    _inFlight -= 1;
  }
}

export function isDbBusy(): boolean {
  return _inFlight > 0;
}

/** Open (or create) a database at the given path and initialize the schema. */
export function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

/** Process-wide singleton, lazily opened at config.dbPath. */
export function getDb(): Database.Database {
  if (!_db) _db = openDb(config.dbPath);
  return _db;
}

/** Swap in an externally-created db (tests). Pass null to reset. */
export function setDb(db: Database.Database | null): void {
  if (_db && _db !== db) _db.close();
  _db = db;
}

/** Short prefixed id, e.g. "obl-3f2a9c1b". */
export function genId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}
