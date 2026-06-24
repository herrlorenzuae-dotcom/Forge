import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, setDb } from '../db/db.js';
import { buildRegistry, sanitize, restore, restoreString } from './anonymize.js';

beforeEach(() => {
  setDb(new Database(':memory:'));
  const db = getDb();
  db.prepare(`INSERT INTO clients (id, name) VALUES ('c', 'Test')`).run();
  db.prepare(`INSERT INTO entities (id, client_id, name, kind, role, source) VALUES ('e1','c','Halcyon BidCo S.à r.l.','spv','acquisition_vehicle','manual')`).run();
  db.prepare(`INSERT INTO entities (id, client_id, name, kind, role, source) VALUES ('e2','c','Dr. Katharina Brandt','individual','ubo','manual')`).run();
});

describe('anonymizer', () => {
  it('masks entity and person names and restores them round-trip', () => {
    const reg = buildRegistry('c');
    const text = 'Halcyon BidCo S.à r.l. is owned by Dr. Katharina Brandt.';
    const { sanitized, stats } = sanitize(text, reg);
    expect(sanitized).not.toContain('Halcyon BidCo');
    expect(sanitized).not.toContain('Katharina');
    expect(sanitized).toContain('[ENTITY_1]');
    expect(sanitized).toContain('[PERSON_1]');
    expect(Object.keys(stats).length).toBe(2);
    expect(restoreString(sanitized, reg)).toBe(text);
  });

  it('restores placeholders nested in objects', () => {
    const reg = buildRegistry('c');
    const masked = { value: '[ENTITY_1]', list: ['owned by [PERSON_1]'] };
    const restored = restore(masked, reg);
    expect(restored.value).toBe('Halcyon BidCo S.à r.l.');
    expect(restored.list[0]).toBe('owned by Dr. Katharina Brandt');
  });
});
