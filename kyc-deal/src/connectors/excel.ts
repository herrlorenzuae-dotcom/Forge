/**
 * Excel structure import. A group structure delivered as a workbook (the
 * deterministic, high-confidence intake path) is parsed into the same
 * StructureSnapshot the connectors produce, so it flows through the very same
 * reconciliation. Two sheets:
 *
 *   Entities       Ref | Name | Kind | Role | Jurisdiction | RegistrationNo |
 *                  IncorporationDate | Status | Notes
 *   Relationships  ParentRef | ChildRef | Type | Percent | Mechanism | AsOf
 *
 * Type is "ownership" (a shareholding, % in Percent) or "control" (voting /
 * board / shareholders' agreement, described in Mechanism). ParentRef and
 * ChildRef may reference a row's Ref or its Name.
 *
 * PowerPoint / Visio export to this shape, or are derived into it by the
 * model — either way the snapshot, and everything downstream, is identical.
 */

import * as XLSX from 'xlsx';
import type { RawEdge, RawEntity, StructureSnapshot } from './types.js';
import type { EdgeKind, EntityKind, EntityRole } from '../types.js';

const KINDS = new Set<EntityKind>(['individual', 'operating', 'holding', 'spv', 'fund', 'trust', 'partnership', 'foundation']);
const ROLES = new Set<EntityRole>(['acquisition_vehicle', 'topco', 'intermediate', 'ubo', 'target', 'other']);

const nkey = (s: string) => s.toLowerCase().replace(/[\s_]/g, '');

function field(row: Record<string, unknown>, names: string[]): string {
  const map = new Map(Object.keys(row).map((k) => [nkey(k), k]));
  for (const n of names) {
    const key = map.get(nkey(n));
    if (key !== undefined && row[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim();
  }
  return '';
}

function sheet(wb: XLSX.WorkBook, names: string[]): Record<string, unknown>[] {
  const want = new Set(names.map(nkey));
  const found = wb.SheetNames.find((n) => want.has(nkey(n)));
  if (!found) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[found], { raw: false, defval: '' }) as Record<string, unknown>[];
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'entity';
}

export function coerceKind(v: string): EntityKind {
  const k = nkey(v) as EntityKind;
  if (KINDS.has(k)) return k;
  if (/person|individual|natural/i.test(v)) return 'individual';
  if (/spv|bidco|acquisition/i.test(v)) return 'spv';
  if (/fund/i.test(v)) return 'fund';
  if (/trust/i.test(v)) return 'trust';
  if (/partner/i.test(v)) return 'partnership';
  if (/foundation|stiftung/i.test(v)) return 'foundation';
  return 'holding';
}

export function coerceRole(v: string): EntityRole {
  const r = nkey(v) as EntityRole;
  if (ROLES.has(r)) return r;
  if (/ubo|beneficial/i.test(v)) return 'ubo';
  if (/top/i.test(v)) return 'topco';
  if (/bid|acquisition|spv/i.test(v)) return 'acquisition_vehicle';
  if (/target|asset/i.test(v)) return 'target';
  if (/inter|holding|mid/i.test(v)) return 'intermediate';
  return 'other';
}

export function parseStructureWorkbook(buf: Buffer, today = new Date().toISOString().slice(0, 10)): StructureSnapshot {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });

  const entityRows = sheet(wb, ['Entities', 'Entity', 'Companies', 'Gesellschaften']);
  const edgeRows = sheet(wb, ['Relationships', 'Relations', 'Edges', 'Ownership', 'Beziehungen']);

  const entities: RawEntity[] = [];
  const byRef = new Map<string, string>(); // ref or name (normalized) -> ref
  for (const row of entityRows) {
    const name = field(row, ['Name', 'EntityName', 'Company']);
    if (!name) continue;
    let ref = field(row, ['Ref', 'Id', 'Key']);
    if (!ref) ref = slug(name);
    const ent: RawEntity = {
      ref,
      name,
      kind: coerceKind(field(row, ['Kind', 'Type', 'EntityType', 'Art'])),
      role: coerceRole(field(row, ['Role', 'Function', 'Rolle'])),
      jurisdiction: field(row, ['Jurisdiction', 'Country', 'Land']),
      registration_no: field(row, ['RegistrationNo', 'Registration', 'RegNo', 'Register', 'HRB']),
      incorporation_date: field(row, ['IncorporationDate', 'Incorporated', 'Founded', 'Gruendung']),
      status: field(row, ['Status']) || 'active',
      as_of: field(row, ['AsOf', 'Date']) || today,
      notes: field(row, ['Notes', 'Comment', 'Bemerkung']),
    };
    entities.push(ent);
    byRef.set(nkey(ref), ref);
    byRef.set(nkey(name), ref);
  }

  const resolve = (raw: string): string | null => byRef.get(nkey(raw)) ?? null;

  const edges: RawEdge[] = [];
  for (const row of edgeRows) {
    const parent = resolve(field(row, ['ParentRef', 'Parent', 'Owner', 'From', 'Mutter']));
    const child = resolve(field(row, ['ChildRef', 'Child', 'Owned', 'To', 'Tochter']));
    if (!parent || !child) continue;
    const typeRaw = field(row, ['Type', 'Kind', 'Relationship', 'Art']);
    const isControl = /control|kontrolle|voting|stimm|board|veto|gp|manager/i.test(typeRaw);
    const pctStr = field(row, ['Percent', 'Pct', 'Percentage', 'Share', 'Anteil', 'Quote']).replace('%', '').replace(',', '.');
    const pct = Number(pctStr);
    const kind: EdgeKind = isControl ? 'control' : 'shares';
    edges.push({
      parentRef: parent,
      childRef: child,
      pct: Number.isFinite(pct) ? pct : 0,
      kind,
      mechanism: field(row, ['Mechanism', 'Control', 'Basis', 'Mechanismus']),
      as_of: field(row, ['AsOf', 'Date', 'Datum']) || today,
    });
  }

  return { entities, edges, ubos: [], attributes: [] };
}

/** Build the blank import template as a workbook (for `npm run template:xlsx`). */
export function buildTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const entities = [
    { Ref: 'ubo-1', Name: 'Jane Doe', Kind: 'individual', Role: 'ubo', Jurisdiction: 'DE', RegistrationNo: '', IncorporationDate: '', Status: 'active', Notes: 'Ultimate beneficial owner' },
    { Ref: 'topco', Name: 'Example TopCo GmbH', Kind: 'holding', Role: 'topco', Jurisdiction: 'DE', RegistrationNo: 'HRB 00000', IncorporationDate: '2020-01-01', Status: 'active', Notes: '' },
    { Ref: 'bidco', Name: 'Example BidCo S.à r.l.', Kind: 'spv', Role: 'acquisition_vehicle', Jurisdiction: 'LU', RegistrationNo: 'B 00000', IncorporationDate: '2026-01-01', Status: 'active', Notes: 'Acquisition vehicle' },
    { Ref: 'target', Name: 'Example Target S.A.', Kind: 'operating', Role: 'target', Jurisdiction: 'LU', RegistrationNo: 'B 11111', IncorporationDate: '2015-01-01', Status: 'active', Notes: 'Asset' },
  ];
  const relationships = [
    { ParentRef: 'ubo-1', ChildRef: 'topco', Type: 'ownership', Percent: 100, Mechanism: '', AsOf: '2026-01-01' },
    { ParentRef: 'topco', ChildRef: 'bidco', Type: 'ownership', Percent: 100, Mechanism: '', AsOf: '2026-01-01' },
    { ParentRef: 'bidco', ChildRef: 'target', Type: 'ownership', Percent: 94, Mechanism: '', AsOf: '2026-01-01' },
    { ParentRef: 'ubo-1', ChildRef: 'topco', Type: 'control', Percent: '', Mechanism: "Shareholders' agreement: board majority", AsOf: '2026-01-01' },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entities), 'Entities');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(relationships), 'Relationships');
  return wb;
}
