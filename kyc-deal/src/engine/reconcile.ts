/**
 * Reconciliation. A delivered structure (a group chart, a Quantium pull, a
 * manual snapshot) is never blindly written over what we hold. Instead we
 * diff it against the stored structure by natural key and surface every
 * difference — added, changed (with the exact field conflict), or missing —
 * so a human decides. This is what keeps the structure dynamic without losing
 * the audit trail a bank relies on.
 *
 * Matching is by natural key: registration number when present, otherwise the
 * normalized name + jurisdiction. Edges are keyed by their endpoints + kind,
 * so ownership and control links reconcile independently.
 */

import { getDb, genId } from '../db/db.js';
import type { StructureSnapshot, RawEntity, RawEdge } from '../connectors/types.js';
import type { Entity, OwnershipEdge } from '../types.js';

const norm = (s: string) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export function entityKey(name: string, regNo: string, juris: string): string {
  const reg = norm(regNo);
  return reg ? `reg:${reg}` : `nm:${norm(name)}|${norm(juris)}`;
}
const edgeKey = (parentKey: string, childKey: string, kind: string): string => `${parentKey}»${childKey}»${kind}`;

export interface FieldConflict {
  field: string;
  current: string;
  incoming: string;
}

export interface EntityDiff {
  status: 'added' | 'changed' | 'unchanged' | 'removed';
  key: string;
  name: string;
  existingId?: string;
  conflicts: FieldConflict[];
}

export interface EdgeDiff {
  status: 'added' | 'changed' | 'unchanged' | 'removed';
  key: string;
  label: string;
  conflicts: FieldConflict[];
}

export interface StructureDiff {
  entities: EntityDiff[];
  edges: EdgeDiff[];
  summary: { added: number; changed: number; removed: number; unchanged: number };
}

const ENTITY_FIELDS: { field: keyof RawEntity; label: string }[] = [
  { field: 'name', label: 'name' },
  { field: 'kind', label: 'kind' },
  { field: 'role', label: 'role' },
  { field: 'jurisdiction', label: 'jurisdiction' },
  { field: 'registration_no', label: 'registration_no' },
  { field: 'incorporation_date', label: 'incorporation_date' },
  { field: 'status', label: 'status' },
];

function loadExisting(clientId: string): { entities: Entity[]; edges: OwnershipEdge[] } {
  const db = getDb();
  return {
    entities: db.prepare(`SELECT * FROM entities WHERE client_id = ?`).all(clientId) as Entity[],
    edges: db.prepare(`SELECT * FROM ownership_edges WHERE client_id = ?`).all(clientId) as OwnershipEdge[],
  };
}

export function diffStructure(clientId: string, snapshot: StructureSnapshot): StructureDiff {
  const { entities: exEntities, edges: exEdges } = loadExisting(clientId);
  const exByKey = new Map(exEntities.map((e) => [entityKey(e.name, e.registration_no, e.jurisdiction), e]));
  const idToKey = new Map(exEntities.map((e) => [e.id, entityKey(e.name, e.registration_no, e.jurisdiction)]));

  // ── entities ──
  const entityDiffs: EntityDiff[] = [];
  const incomingKeys = new Set<string>();
  const refToKey = new Map<string, string>();
  for (const inc of snapshot.entities) {
    const key = entityKey(inc.name, inc.registration_no, inc.jurisdiction);
    refToKey.set(inc.ref, key);
    incomingKeys.add(key);
    const ex = exByKey.get(key);
    if (!ex) {
      entityDiffs.push({ status: 'added', key, name: inc.name, conflicts: [] });
      continue;
    }
    const conflicts: FieldConflict[] = [];
    for (const { field, label } of ENTITY_FIELDS) {
      const incoming = String(inc[field] ?? '').trim();
      const current = String((ex as unknown as Record<string, unknown>)[field] ?? '').trim();
      if (incoming && norm(incoming) !== norm(current)) conflicts.push({ field: label, current, incoming });
    }
    entityDiffs.push({ status: conflicts.length ? 'changed' : 'unchanged', key, name: inc.name, existingId: ex.id, conflicts });
  }
  for (const ex of exEntities) {
    const key = entityKey(ex.name, ex.registration_no, ex.jurisdiction);
    if (!incomingKeys.has(key)) entityDiffs.push({ status: 'removed', key, name: ex.name, existingId: ex.id, conflicts: [] });
  }

  // ── edges ──
  const nameByExId = new Map(exEntities.map((e) => [e.id, e.name]));
  const exEdgeByKey = new Map<string, OwnershipEdge>();
  for (const e of exEdges) {
    const pk = idToKey.get(e.parent_id);
    const ck = idToKey.get(e.child_id);
    if (pk && ck) exEdgeByKey.set(edgeKey(pk, ck, e.kind), e);
  }
  const edgeDiffs: EdgeDiff[] = [];
  const incomingEdgeKeys = new Set<string>();
  const incNameByRef = new Map(snapshot.entities.map((e) => [e.ref, e.name]));
  for (const inc of snapshot.edges) {
    const pk = refToKey.get(inc.parentRef);
    const ck = refToKey.get(inc.childRef);
    if (!pk || !ck) continue;
    const key = edgeKey(pk, ck, inc.kind);
    incomingEdgeKeys.add(key);
    const label = `${incNameByRef.get(inc.parentRef) ?? '?'} → ${incNameByRef.get(inc.childRef) ?? '?'} (${inc.kind})`;
    const ex = exEdgeByKey.get(key);
    if (!ex) {
      edgeDiffs.push({ status: 'added', key, label, conflicts: [] });
      continue;
    }
    const conflicts: FieldConflict[] = [];
    if (inc.kind !== 'control' && Number(inc.pct) !== Number(ex.pct)) conflicts.push({ field: 'pct', current: `${ex.pct}%`, incoming: `${inc.pct}%` });
    const incMech = (inc.mechanism ?? '').trim();
    if (incMech && norm(incMech) !== norm(ex.mechanism)) conflicts.push({ field: 'mechanism', current: ex.mechanism, incoming: incMech });
    edgeDiffs.push({ status: conflicts.length ? 'changed' : 'unchanged', key, label, conflicts });
  }
  for (const [key, e] of exEdgeByKey) {
    if (!incomingEdgeKeys.has(key)) {
      edgeDiffs.push({ status: 'removed', key, label: `${nameByExId.get(e.parent_id) ?? '?'} → ${nameByExId.get(e.child_id) ?? '?'} (${e.kind})`, conflicts: [] });
    }
  }

  const all = [...entityDiffs, ...edgeDiffs];
  const summary = {
    added: all.filter((d) => d.status === 'added').length,
    changed: all.filter((d) => d.status === 'changed').length,
    removed: all.filter((d) => d.status === 'removed').length,
    unchanged: all.filter((d) => d.status === 'unchanged').length,
  };
  return { entities: entityDiffs, edges: edgeDiffs, summary };
}

export interface ApplyResult {
  entitiesAdded: number;
  entitiesUpdated: number;
  edgesAdded: number;
  edgesUpdated: number;
  entitiesRemoved: number;
  edgesRemoved: number;
}

/** Apply a snapshot: upsert by natural key, never duplicating. With
 *  removeMissing, prune entities/edges absent from the snapshot (and their
 *  dependent rows). */
export function applyStructure(clientId: string, snapshot: StructureSnapshot, opts: { removeMissing?: boolean } = {}): ApplyResult {
  const db = getDb();
  const res: ApplyResult = { entitiesAdded: 0, entitiesUpdated: 0, edgesAdded: 0, edgesUpdated: 0, entitiesRemoved: 0, edgesRemoved: 0 };

  const tx = db.transaction(() => {
    const exEntities = db.prepare(`SELECT * FROM entities WHERE client_id = ?`).all(clientId) as Entity[];
    const keyToId = new Map(exEntities.map((e) => [entityKey(e.name, e.registration_no, e.jurisdiction), e.id]));
    const idToKey = new Map(exEntities.map((e) => [e.id, entityKey(e.name, e.registration_no, e.jurisdiction)]));

    const refToId = new Map<string, string>();
    const incomingEntityKeys = new Set<string>();

    const insEntity = db.prepare(
      `INSERT INTO entities (id, client_id, name, kind, role, jurisdiction, registration_no, incorporation_date, status, source, source_ref, as_of, notes)
       VALUES (@id, @client_id, @name, @kind, @role, @jurisdiction, @registration_no, @incorporation_date, @status, 'manual', @source_ref, @as_of, @notes)`,
    );
    // keep current value when the incoming field is blank (NULLIF '' → COALESCE)
    const updEntity = db.prepare(
      `UPDATE entities SET
         name = COALESCE(NULLIF(@name,''), name),
         kind = COALESCE(NULLIF(@kind,''), kind),
         role = COALESCE(NULLIF(@role,''), role),
         jurisdiction = COALESCE(NULLIF(@jurisdiction,''), jurisdiction),
         registration_no = COALESCE(NULLIF(@registration_no,''), registration_no),
         incorporation_date = COALESCE(NULLIF(@incorporation_date,''), incorporation_date),
         status = COALESCE(NULLIF(@status,''), status),
         notes = COALESCE(NULLIF(@notes,''), notes),
         as_of = @as_of
       WHERE id = @id`,
    );

    for (const inc of snapshot.entities) {
      const key = entityKey(inc.name, inc.registration_no, inc.jurisdiction);
      incomingEntityKeys.add(key);
      const existingId = keyToId.get(key);
      const row = {
        name: inc.name,
        kind: inc.kind,
        role: inc.role,
        jurisdiction: inc.jurisdiction,
        registration_no: inc.registration_no,
        incorporation_date: inc.incorporation_date,
        status: inc.status,
        notes: inc.notes,
        as_of: inc.as_of,
      };
      if (existingId) {
        updEntity.run({ id: existingId, ...row });
        refToId.set(inc.ref, existingId);
        res.entitiesUpdated++;
      } else {
        const id = genId('ent');
        insEntity.run({ id, client_id: clientId, source_ref: inc.ref, ...row });
        keyToId.set(key, id);
        idToKey.set(id, key);
        refToId.set(inc.ref, id);
        res.entitiesAdded++;
      }
    }

    // edges
    const exEdges = db.prepare(`SELECT * FROM ownership_edges WHERE client_id = ?`).all(clientId) as OwnershipEdge[];
    const exEdgeByKey = new Map<string, OwnershipEdge>();
    for (const e of exEdges) {
      const pk = idToKey.get(e.parent_id);
      const ck = idToKey.get(e.child_id);
      if (pk && ck) exEdgeByKey.set(edgeKey(pk, ck, e.kind), e);
    }
    const insEdge = db.prepare(
      `INSERT INTO ownership_edges (id, client_id, parent_id, child_id, pct, kind, mechanism, source, source_ref, as_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
    );
    const updEdge = db.prepare(`UPDATE ownership_edges SET pct = ?, mechanism = ?, as_of = ? WHERE id = ?`);
    const incomingEdgeKeys = new Set<string>();
    for (const inc of snapshot.edges) {
      const p = refToId.get(inc.parentRef);
      const c = refToId.get(inc.childRef);
      if (!p || !c) continue;
      const pk = idToKey.get(p)!;
      const ck = idToKey.get(c)!;
      const key = edgeKey(pk, ck, inc.kind);
      incomingEdgeKeys.add(key);
      const ex = exEdgeByKey.get(key);
      if (ex) {
        updEdge.run(inc.pct, inc.mechanism ?? '', inc.as_of, ex.id);
        res.edgesUpdated++;
      } else {
        insEdge.run(genId('edge'), clientId, p, c, inc.pct, inc.kind, inc.mechanism ?? '', `${inc.parentRef}->${inc.childRef}`, inc.as_of);
        res.edgesAdded++;
      }
    }

    if (opts.removeMissing) {
      for (const [key, e] of exEdgeByKey) {
        if (!incomingEdgeKeys.has(key)) {
          db.prepare(`DELETE FROM ownership_edges WHERE id = ?`).run(e.id);
          res.edgesRemoved++;
        }
      }
      for (const ex of exEntities) {
        const key = entityKey(ex.name, ex.registration_no, ex.jurisdiction);
        if (!incomingEntityKeys.has(key)) {
          db.prepare(`DELETE FROM ownership_edges WHERE parent_id = ? OR child_id = ?`).run(ex.id, ex.id);
          db.prepare(`DELETE FROM entity_attributes WHERE entity_id = ?`).run(ex.id);
          db.prepare(`DELETE FROM ubos WHERE entity_id = ?`).run(ex.id);
          db.prepare(`DELETE FROM entities WHERE id = ?`).run(ex.id);
          res.entitiesRemoved++;
        }
      }
    }
  });
  tx();
  return res;
}
