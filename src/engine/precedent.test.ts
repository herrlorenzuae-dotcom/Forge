import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import { openDb, setDb } from '../db/db.js';
import { seedDatabase } from '../seed/seed.js';
import { resetHealthCache } from '../ai/ollama.js';
import { listPrecedents, markPrecedentsUsed, promotePrecedent, searchPrecedents } from './precedent.js';
import { resolveComment } from './comments.js';

describe('the compounding loop', () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-prec-'));
    db = openDb(path.join(dir, 'test.db'));
    await seedDatabase(db, { embeddings: false });
    setDb(db);
    resetHealthCache();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ollama down')));
  });

  afterEach(() => {
    setDb(null);
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('an accepted resolution becomes precedent; an edited one weighs more', async () => {
    db.prepare(`UPDATE comments SET status = 'suggested', suggested_resolution = 'Hold the $75M MFN threshold; offer semi-annual compendium delivery instead.' WHERE id = 'c-03'`).run();
    await resolveComment('c-03', 'accept');
    const accepted = listPrecedents(db).find((p) => p.source_id === 'c-03');
    expect(accepted?.kind).toBe('resolution');
    expect(accepted?.weight).toBe(1.0);

    await resolveComment('c-06', 'edit', 'Initial compendium within 60 days of final closing; elections provision-by-provision.');
    const edited = listPrecedents(db).find((p) => p.source_id === 'c-06');
    expect(edited?.weight).toBeCloseTo(1.3);
  });

  it('re-promotion bumps weight instead of duplicating', async () => {
    const first = await promotePrecedent(db, {
      kind: 'resolution',
      topic: 'fees',
      title: 'fee resolution',
      text: 'Step-down on earlier of investment period end or successor fund fees.',
      sourceType: 'comment',
      sourceId: 'c-04',
    });
    const again = await promotePrecedent(db, {
      kind: 'resolution',
      topic: 'fees',
      title: 'fee resolution',
      text: 'Step-down on earlier of investment period end or successor fund fees.',
      sourceType: 'comment',
      sourceId: 'c-04',
    });
    expect(again.id).toBe(first.id);
    expect(again.weight).toBeCloseTo(1.2);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM precedents`).get()).toEqual({ n: 1 });
  });

  it('search ranks earned weight above raw relevance ties, and use compounds', async () => {
    await promotePrecedent(db, {
      kind: 'resolution',
      topic: 'mfn',
      title: 'MFN threshold resolution (light)',
      text: 'Hold the MFN threshold at seventy-five million dollars.',
      sourceType: 'comment',
      sourceId: 'x-1',
      weight: 1.0,
    });
    await promotePrecedent(db, {
      kind: 'resolution',
      topic: 'mfn',
      title: 'MFN threshold resolution (heavy)',
      text: 'Hold the MFN threshold at seventy-five million dollars.',
      sourceType: 'comment',
      sourceId: 'x-2',
      weight: 1.8,
    });
    const hits = await searchPrecedents(db, { query: 'MFN threshold seventy-five million', topic: 'mfn' });
    expect(hits[0]?.source_id).toBe('x-2'); // same text, heavier weight wins

    markPrecedentsUsed(db, [hits[0].id, hits[0].id, hits[0].id]);
    const after = listPrecedents(db).find((p) => p.id === hits[0].id);
    expect(after?.uses).toBe(3);
    expect(after?.weight).toBeCloseTo(1.95); // 1.8 + 3×0.05
  });
});
