/** Manual structure edits — the escape hatch that keeps the chart dynamic
 *  when an import got something wrong or the deal moves. Every write re-renders
 *  the org chart, since the chart is a pure projection of these rows. */

import { getDb, genId, today } from '../db/db.js';
import type { EdgeKind, Entity, EntityKind, EntityRole, OwnershipEdge } from '../types.js';

export interface EntityInput {
  id?: string;
  name: string;
  kind: EntityKind;
  role: EntityRole;
  jurisdiction?: string;
  registration_no?: string;
  incorporation_date?: string;
  status?: string;
  notes?: string;
}

export function upsertEntity(clientId: string, input: EntityInput): Entity {
  const db = getDb();
  if (!input.name?.trim()) throw new Error('name is required');
  if (input.id) {
    const exists = db.prepare(`SELECT id FROM entities WHERE id = ? AND client_id = ?`).get(input.id, clientId);
    if (!exists) throw new Error('entity not found');
    db.prepare(
      `UPDATE entities SET name=?, kind=?, role=?, jurisdiction=?, registration_no=?, incorporation_date=?, status=?, notes=?, source='manual', as_of=? WHERE id=?`,
    ).run(input.name, input.kind, input.role, input.jurisdiction ?? '', input.registration_no ?? '', input.incorporation_date ?? '', input.status ?? 'active', input.notes ?? '', today(), input.id);
    return db.prepare(`SELECT * FROM entities WHERE id = ?`).get(input.id) as Entity;
  }
  const id = genId('ent');
  db.prepare(
    `INSERT INTO entities (id, client_id, name, kind, role, jurisdiction, registration_no, incorporation_date, status, source, source_ref, as_of, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', '', ?, ?)`,
  ).run(id, clientId, input.name, input.kind, input.role, input.jurisdiction ?? '', input.registration_no ?? '', input.incorporation_date ?? '', input.status ?? 'active', today(), input.notes ?? '');
  return db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id) as Entity;
}

export function deleteEntity(clientId: string, entityId: string): { ok: true } {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM ownership_edges WHERE client_id = ? AND (parent_id = ? OR child_id = ?)`).run(clientId, entityId, entityId);
    db.prepare(`DELETE FROM entity_attributes WHERE client_id = ? AND entity_id = ?`).run(clientId, entityId);
    db.prepare(`DELETE FROM ubos WHERE client_id = ? AND entity_id = ?`).run(clientId, entityId);
    db.prepare(`DELETE FROM entities WHERE client_id = ? AND id = ?`).run(clientId, entityId);
  });
  tx();
  return { ok: true };
}

export interface EdgeInput {
  id?: string;
  parent_id: string;
  child_id: string;
  pct?: number;
  kind: EdgeKind;
  mechanism?: string;
}

export function upsertEdge(clientId: string, input: EdgeInput): OwnershipEdge {
  const db = getDb();
  if (input.parent_id === input.child_id) throw new Error('an entity cannot own or control itself');
  for (const eid of [input.parent_id, input.child_id]) {
    if (!db.prepare(`SELECT id FROM entities WHERE id = ? AND client_id = ?`).get(eid, clientId)) throw new Error('endpoint entity not found');
  }
  if (input.id) {
    db.prepare(`UPDATE ownership_edges SET parent_id=?, child_id=?, pct=?, kind=?, mechanism=?, source='manual', as_of=? WHERE id=? AND client_id=?`).run(
      input.parent_id,
      input.child_id,
      input.pct ?? 0,
      input.kind,
      input.mechanism ?? '',
      today(),
      input.id,
      clientId,
    );
    return db.prepare(`SELECT * FROM ownership_edges WHERE id = ?`).get(input.id) as OwnershipEdge;
  }
  const id = genId('edge');
  db.prepare(
    `INSERT INTO ownership_edges (id, client_id, parent_id, child_id, pct, kind, mechanism, source, source_ref, as_of) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', '', ?)`,
  ).run(id, clientId, input.parent_id, input.child_id, input.pct ?? 0, input.kind, input.mechanism ?? '', today());
  return db.prepare(`SELECT * FROM ownership_edges WHERE id = ?`).get(id) as OwnershipEdge;
}

export function deleteEdge(clientId: string, edgeId: string): { ok: true } {
  getDb().prepare(`DELETE FROM ownership_edges WHERE id = ? AND client_id = ?`).run(edgeId, clientId);
  return { ok: true };
}
