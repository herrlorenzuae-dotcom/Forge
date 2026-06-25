import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, setDb } from '../db/db.js';
import { importSnapshot } from './structure.js';
import { diffStructure, applyStructure } from './reconcile.js';
import type { StructureSnapshot } from '../connectors/types.js';

const BASE: StructureSnapshot = {
  entities: [
    { ref: 'p', name: 'Jane Doe', kind: 'individual', role: 'ubo', jurisdiction: 'DE', registration_no: '', incorporation_date: '', status: 'active', as_of: '2026-01-01', notes: '' },
    { ref: 'h', name: 'TopCo GmbH', kind: 'holding', role: 'topco', jurisdiction: 'DE', registration_no: 'HRB 1', incorporation_date: '2020-01-01', status: 'active', as_of: '2026-01-01', notes: '' },
    { ref: 'b', name: 'BidCo Sàrl', kind: 'spv', role: 'acquisition_vehicle', jurisdiction: 'LU', registration_no: 'B 2', incorporation_date: '2026-01-01', status: 'active', as_of: '2026-01-01', notes: '' },
  ],
  edges: [
    { parentRef: 'p', childRef: 'h', pct: 100, kind: 'shares', as_of: '2026-01-01' },
    { parentRef: 'h', childRef: 'b', pct: 80, kind: 'shares', as_of: '2026-01-01' },
  ],
  ubos: [],
  attributes: [],
};

// same parties (matched by reg no / name), but: h→b now 90%, a new target +
// edge, and the p→h edge dropped.
const MODIFIED: StructureSnapshot = {
  entities: [
    ...BASE.entities,
    { ref: 't', name: 'Target SA', kind: 'operating', role: 'target', jurisdiction: 'LU', registration_no: 'B 3', incorporation_date: '2015-01-01', status: 'active', as_of: '2026-06-01', notes: '' },
  ],
  edges: [
    { parentRef: 'h', childRef: 'b', pct: 90, kind: 'shares', as_of: '2026-06-01' },
    { parentRef: 'b', childRef: 't', pct: 94, kind: 'shares', as_of: '2026-06-01' },
  ],
  ubos: [],
  attributes: [],
};

beforeEach(() => {
  setDb(new Database(':memory:'));
  getDb().prepare(`INSERT INTO clients (id, name) VALUES ('c', 'Test')`).run();
  importSnapshot('c', BASE, []);
});

describe('diffStructure', () => {
  it('flags added, changed and removed without touching the store', () => {
    const diff = diffStructure('c', MODIFIED);
    expect(diff.summary).toEqual({ added: 2, changed: 1, removed: 1, unchanged: 3 });
    const changed = diff.edges.find((e) => e.status === 'changed');
    expect(changed?.conflicts[0]).toMatchObject({ field: 'pct', current: '80%', incoming: '90%' });
    // store is untouched by a diff
    expect((getDb().prepare(`SELECT COUNT(*) AS n FROM ownership_edges`).get() as { n: number }).n).toBe(2);
  });
});

describe('applyStructure', () => {
  it('upserts by natural key and prunes missing when asked, converging to no diff', () => {
    applyStructure('c', MODIFIED, { removeMissing: true });
    const diff = diffStructure('c', MODIFIED);
    expect(diff.summary).toEqual({ added: 0, changed: 0, removed: 0, unchanged: 6 }); // 4 entities + 2 edges
    // no duplicate entities created
    expect((getDb().prepare(`SELECT COUNT(*) AS n FROM entities`).get() as { n: number }).n).toBe(4);
    const bidcoEdge = getDb().prepare(`SELECT pct FROM ownership_edges WHERE kind='shares' AND pct=90`).get() as { pct: number } | undefined;
    expect(bidcoEdge?.pct).toBe(90);
  });

  it('does not duplicate on a no-op re-apply', () => {
    applyStructure('c', BASE, {});
    expect((getDb().prepare(`SELECT COUNT(*) AS n FROM entities`).get() as { n: number }).n).toBe(3);
    expect((getDb().prepare(`SELECT COUNT(*) AS n FROM ownership_edges`).get() as { n: number }).n).toBe(2);
  });
});
