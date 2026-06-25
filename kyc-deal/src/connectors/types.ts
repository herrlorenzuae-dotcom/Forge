/**
 * The seam between KYC Deal and the client's systems of record. The app talks
 * only to these interfaces, never to a vendor SDK directly, so swapping the
 * bundled mock for the real Quantium / YSolutions is a single implementation.
 *
 * Connector-side entities are addressed by a stable `ref`; edges, UBOs and
 * attributes reference entities by that ref. The structure engine maps refs
 * to database ids on import.
 */

import type { EdgeKind, EntityKind, EntityRole, UboBasis } from '../types.js';

export interface RawEntity {
  ref: string;
  name: string;
  kind: EntityKind;
  role: EntityRole;
  jurisdiction: string;
  registration_no: string;
  incorporation_date: string;
  status: string;
  as_of: string;
  notes: string;
}

export interface RawEdge {
  parentRef: string;
  childRef: string;
  pct: number;
  kind: EdgeKind;
  /** For control edges: the mechanism (voting majority, board control,
   *  shareholders' agreement, GP/manager, veto rights …). */
  mechanism?: string;
  as_of: string;
}

export interface RawUbo {
  entityRef: string;
  basis: UboBasis;
  pct: number;
  pep: boolean;
  residence: string;
  as_of: string;
}

export interface RawAttribute {
  entityRef: string;
  key: string;
  value: string;
  as_of: string;
}

export interface StructureSnapshot {
  entities: RawEntity[];
  edges: RawEdge[];
  ubos: RawUbo[];
  attributes: RawAttribute[];
}

export interface CurrencyItem {
  ref: string;
  name: string;
  as_of: string;
  ageDays: number;
  stale: boolean;
}

export interface CurrencyReport {
  checkedAt: string;
  staleDays: number;
  items: CurrencyItem[];
  staleCount: number;
}

/** Quantium: corporate registry + structure, with a currency/Aktualität check. */
export interface StructureConnector {
  readonly name: string;
  getStructure(clientRef: string): Promise<StructureSnapshot>;
  verifyCurrency(clientRef: string, staleDays: number): Promise<CurrencyReport>;
}

/** YSolutions: the softer KYC data layer (contacts, source of wealth, tax). */
export interface DataConnector {
  readonly name: string;
  /** Supplemental, citable attributes keyed by entity ref. */
  getData(clientRef: string): Promise<RawAttribute[]>;
}

export interface Connectors {
  quantium: StructureConnector;
  ysolutions: DataConnector;
}
