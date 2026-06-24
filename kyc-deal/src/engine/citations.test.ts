import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, setDb } from '../db/db.js';
import { verifyCitations } from './citations.js';

beforeEach(() => {
  setDb(new Database(':memory:'));
  const db = getDb();
  db.prepare(`INSERT INTO clients (id, name) VALUES ('c', 'Test')`).run();
  db.prepare(`INSERT INTO entities (id, client_id, name, kind, role, source) VALUES ('e1','c','BidCo','spv','acquisition_vehicle','manual')`).run();
  db.prepare(`INSERT INTO entity_attributes (id, client_id, entity_id, key, value, source) VALUES ('a1','c','e1','LEI','5299009HALCYONBIDCO12','quantium')`).run();
});

describe('verifyCitations', () => {
  it('verifies a quote that appears verbatim in the cited fact', () => {
    const r = verifyCitations([{ factType: 'attribute', factId: 'a1', quote: '5299009HALCYONBIDCO12' }], { mappings: [] });
    expect(r.verified).toBe(1);
    expect(r.citations[0].verified).toBe(true);
  });

  it('rejects a quote not found in the cited fact', () => {
    const r = verifyCitations([{ factType: 'attribute', factId: 'a1', quote: 'WRONG-LEI-000' }], { mappings: [] });
    expect(r.verified).toBe(0);
    expect(r.citations[0].verified).toBe(false);
  });

  it('rejects a citation pointing at a missing fact', () => {
    const r = verifyCitations([{ factType: 'attribute', factId: 'nope', quote: 'anything' }], { mappings: [] });
    expect(r.citations[0].verified).toBe(false);
  });
});
