/**
 * The client's structure — the "result" that barely changes between deals.
 * Pulled from Quantium (corporate skeleton + registry facts) and YSolutions
 * (the softer KYC layer), held locally, and verified for currency against
 * Quantium. Every pull is logged in source_syncs.
 */

import { getDb, genId, today } from '../db/db.js';
import { getConnectors } from '../connectors/index.js';
import type { CurrencyReport, StructureSnapshot, RawAttribute } from '../connectors/types.js';
import type { Entity, EntityAttribute, OwnershipEdge, Ubo } from '../types.js';

export interface ClientStructure {
  entities: Entity[];
  edges: OwnershipEdge[];
  ubos: Ubo[];
  attributes: EntityAttribute[];
}

/** Replace the client's stored structure with a fresh snapshot. A refresh
 *  from the source of truth, not a diff: the structure systems are
 *  authoritative, so we mirror them wholesale inside a transaction. */
export function importSnapshot(clientId: string, snapshot: StructureSnapshot, ysAttrs: RawAttribute[]): { entities: number; edges: number; ubos: number; attributes: number } {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM entity_attributes WHERE client_id = ?`).run(clientId);
    db.prepare(`DELETE FROM ownership_edges WHERE client_id = ?`).run(clientId);
    db.prepare(`DELETE FROM ubos WHERE client_id = ?`).run(clientId);
    db.prepare(`DELETE FROM entities WHERE client_id = ?`).run(clientId);

    const refToId = new Map<string, string>();
    const insEntity = db.prepare(
      `INSERT INTO entities (id, client_id, name, kind, role, jurisdiction, registration_no, incorporation_date, status, source, source_ref, as_of, notes)
       VALUES (@id, @client_id, @name, @kind, @role, @jurisdiction, @registration_no, @incorporation_date, @status, 'quantium', @source_ref, @as_of, @notes)`,
    );
    for (const e of snapshot.entities) {
      const id = genId('ent');
      refToId.set(e.ref, id);
      insEntity.run({
        id,
        client_id: clientId,
        name: e.name,
        kind: e.kind,
        role: e.role,
        jurisdiction: e.jurisdiction,
        registration_no: e.registration_no,
        incorporation_date: e.incorporation_date,
        status: e.status,
        source_ref: e.ref,
        as_of: e.as_of,
        notes: e.notes,
      });
    }

    const insEdge = db.prepare(
      `INSERT INTO ownership_edges (id, client_id, parent_id, child_id, pct, kind, source, source_ref, as_of)
       VALUES (?, ?, ?, ?, ?, ?, 'quantium', ?, ?)`,
    );
    let edges = 0;
    for (const e of snapshot.edges) {
      const p = refToId.get(e.parentRef);
      const c = refToId.get(e.childRef);
      if (!p || !c) continue;
      insEdge.run(genId('edge'), clientId, p, c, e.pct, e.kind, `${e.parentRef}->${e.childRef}`, e.as_of);
      edges++;
    }

    const insUbo = db.prepare(
      `INSERT INTO ubos (id, client_id, entity_id, basis, pct, pep, residence, source, source_ref, as_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'quantium', ?, ?)`,
    );
    let ubos = 0;
    for (const u of snapshot.ubos) {
      const eid = refToId.get(u.entityRef);
      if (!eid) continue;
      insUbo.run(genId('ubo'), clientId, eid, u.basis, u.pct, u.pep ? 1 : 0, u.residence, u.entityRef, u.as_of);
      ubos++;
    }

    const insAttr = db.prepare(
      `INSERT INTO entity_attributes (id, client_id, entity_id, key, value, source, source_ref, as_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let attributes = 0;
    for (const a of snapshot.attributes) {
      const eid = refToId.get(a.entityRef);
      if (!eid) continue;
      insAttr.run(genId('attr'), clientId, eid, a.key, a.value, 'quantium', a.entityRef, a.as_of);
      attributes++;
    }
    for (const a of ysAttrs) {
      const eid = refToId.get(a.entityRef);
      if (!eid) continue;
      insAttr.run(genId('attr'), clientId, eid, a.key, a.value, 'ysolutions', a.entityRef, a.as_of);
      attributes++;
    }

    return { entities: snapshot.entities.length, edges, ubos, attributes };
  });
  return tx();
}

function logSync(clientId: string, connector: string, op: string, ok: boolean, items: number, staleItems: number, asOf: string, message: string): void {
  getDb()
    .prepare(
      `INSERT INTO source_syncs (id, client_id, connector, op, ok, items, stale_items, as_of, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(genId('sync'), clientId, connector, op, ok ? 1 : 0, items, staleItems, asOf, message);
}

/** Pull from both connectors and mirror locally. */
export async function refreshFromConnectors(clientId: string, clientRef: string): Promise<{ entities: number; edges: number; ubos: number; attributes: number }> {
  const { quantium, ysolutions } = getConnectors();
  const snapshot = await quantium.getStructure(clientRef);
  const ysAttrs = await ysolutions.getData(clientRef);
  const counts = importSnapshot(clientId, snapshot, ysAttrs);
  logSync(clientId, quantium.name, 'get_structure', true, snapshot.entities.length, 0, today(), `Imported ${snapshot.entities.length} entities, ${counts.edges} edges, ${counts.ubos} UBOs.`);
  logSync(clientId, ysolutions.name, 'get_data', true, ysAttrs.length, 0, today(), `Imported ${ysAttrs.length} supplemental attributes.`);
  return counts;
}

/** Quantium currency / Aktualität check, logged. */
export async function verifyCurrency(clientId: string, clientRef: string): Promise<CurrencyReport> {
  const { quantium } = getConnectors();
  const report = await quantium.verifyCurrency(clientRef, undefined as unknown as number);
  logSync(
    clientId,
    quantium.name,
    'verify_currency',
    report.staleCount === 0,
    report.items.length,
    report.staleCount,
    report.checkedAt,
    report.staleCount === 0 ? 'All records current.' : `${report.staleCount} of ${report.items.length} records are stale (older than ${report.staleDays} days).`,
  );
  return report;
}

export function getStructure(clientId: string): ClientStructure {
  const db = getDb();
  return {
    entities: db.prepare(`SELECT * FROM entities WHERE client_id = ? ORDER BY role, name`).all(clientId) as Entity[],
    edges: db.prepare(`SELECT * FROM ownership_edges WHERE client_id = ?`).all(clientId) as OwnershipEdge[],
    ubos: db.prepare(`SELECT * FROM ubos WHERE client_id = ?`).all(clientId) as Ubo[],
    attributes: db.prepare(`SELECT * FROM entity_attributes WHERE client_id = ? ORDER BY entity_id`).all(clientId) as EntityAttribute[],
  };
}

export function listSyncs(clientId: string): unknown[] {
  return getDb().prepare(`SELECT * FROM source_syncs WHERE client_id = ? ORDER BY checked_at DESC LIMIT 50`).all(clientId);
}
