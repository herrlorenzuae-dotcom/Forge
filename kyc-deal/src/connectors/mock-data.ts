/**
 * Bundled sample structure: Project Halcyon, a (fictional) acquisition of the
 * Meridian Logistics Park through a Luxembourg BidCo, owned up the chain by a
 * German topco and, ultimately, two individuals. This is the kind of "result"
 * that barely moves between deals — the UBO stays who they were.
 *
 * Quantium owns the corporate skeleton (entities, edges, UBOs, registry
 * facts). YSolutions owns the softer KYC layer (contacts, source of wealth,
 * tax status). The split mirrors how the two systems are actually used.
 */

import type { CurrencyItem, RawAttribute, StructureSnapshot } from './types.js';

export const HALCYON_CLIENT_REF = 'project-halcyon';

export const QUANTIUM_STRUCTURE: StructureSnapshot = {
  entities: [
    { ref: 'ubo-brandt', name: 'Dr. Katharina Brandt', kind: 'individual', role: 'ubo', jurisdiction: 'DE', registration_no: '', incorporation_date: '', status: 'active', as_of: '2026-05-12', notes: 'Ultimate beneficial owner via Brandt Familienholding.' },
    { ref: 'ubo-andersson', name: 'Lars Andersson', kind: 'individual', role: 'ubo', jurisdiction: 'SE', registration_no: '', incorporation_date: '', status: 'active', as_of: '2026-05-12', notes: 'Minority beneficial owner.' },
    { ref: 'famco', name: 'Brandt Familienholding GmbH', kind: 'holding', role: 'intermediate', jurisdiction: 'DE', registration_no: 'HRB 184220 (Amtsgericht München)', incorporation_date: '2009-03-18', status: 'active', as_of: '2025-09-30', notes: 'Family holding company.' },
    { ref: 'topco', name: 'Halcyon Beteiligungs GmbH', kind: 'holding', role: 'topco', jurisdiction: 'DE', registration_no: 'HRB 271554 (Amtsgericht München)', incorporation_date: '2021-06-02', status: 'active', as_of: '2026-05-12', notes: 'Top holding for the Halcyon platform.' },
    { ref: 'midco', name: 'Halcyon Holding S.à r.l.', kind: 'holding', role: 'intermediate', jurisdiction: 'LU', registration_no: 'B 254118 (RCS Luxembourg)', incorporation_date: '2021-07-14', status: 'active', as_of: '2026-05-12', notes: 'Luxembourg intermediate holding.' },
    { ref: 'bidco', name: 'Halcyon BidCo S.à r.l.', kind: 'spv', role: 'acquisition_vehicle', jurisdiction: 'LU', registration_no: 'B 281903 (RCS Luxembourg)', incorporation_date: '2026-02-09', status: 'active', as_of: '2026-05-12', notes: 'Special-purpose acquisition vehicle for Project Halcyon.' },
    { ref: 'target', name: 'Meridian Logistics Park S.A.', kind: 'operating', role: 'target', jurisdiction: 'LU', registration_no: 'B 199042 (RCS Luxembourg)', incorporation_date: '2016-11-21', status: 'active', as_of: '2026-04-28', notes: 'Target asset: logistics real estate.' },
  ],
  edges: [
    { parentRef: 'ubo-brandt', childRef: 'famco', pct: 100, kind: 'shares', as_of: '2025-09-30' },
    { parentRef: 'famco', childRef: 'topco', pct: 75, kind: 'shares', as_of: '2026-05-12' },
    { parentRef: 'ubo-andersson', childRef: 'topco', pct: 25, kind: 'shares', as_of: '2026-05-12' },
    { parentRef: 'topco', childRef: 'midco', pct: 100, kind: 'shares', as_of: '2026-05-12' },
    { parentRef: 'midco', childRef: 'bidco', pct: 100, kind: 'shares', as_of: '2026-05-12' },
    { parentRef: 'bidco', childRef: 'target', pct: 94, kind: 'shares', as_of: '2026-04-28' },
  ],
  ubos: [
    { entityRef: 'ubo-brandt', basis: 'ownership', pct: 75, pep: false, residence: 'Munich, Germany', as_of: '2026-05-12' },
    { entityRef: 'ubo-andersson', basis: 'ownership', pct: 25, pep: false, residence: 'Stockholm, Sweden', as_of: '2026-05-12' },
  ],
  attributes: [
    { entityRef: 'bidco', key: 'LEI', value: '5299009HALCYONBIDCO12', as_of: '2026-05-12' },
    { entityRef: 'bidco', key: 'Tax identification number', value: 'LU 2026 2447 118', as_of: '2026-05-12' },
    { entityRef: 'bidco', key: 'Registered address', value: '12, rue Eugène Ruppert, L-2453 Luxembourg', as_of: '2026-05-12' },
    { entityRef: 'bidco', key: 'Regulated status', value: 'Not regulated — special-purpose acquisition vehicle, not a supervised financial institution.', as_of: '2026-05-12' },
    { entityRef: 'bidco', key: 'Listed status', value: 'Not listed on any stock exchange.', as_of: '2026-05-12' },
    { entityRef: 'bidco', key: 'Purpose of entity', value: 'Acquisition and holding of the Meridian Logistics Park.', as_of: '2026-05-12' },
    { entityRef: 'topco', key: 'LEI', value: '529900HALCYONTOPCO77', as_of: '2026-05-12' },
    { entityRef: 'topco', key: 'Registered address', value: 'Maximilianstraße 35, 80539 München, Germany', as_of: '2026-05-12' },
    { entityRef: 'midco', key: 'LEI', value: '529900HALCYONMIDCO45', as_of: '2026-05-12' },
    { entityRef: 'famco', key: 'Registered address', value: 'Maximilianstraße 35, 80539 München, Germany', as_of: '2025-09-30' },
    { entityRef: 'target', key: 'Sector', value: 'Logistics real estate (warehousing and last-mile distribution).', as_of: '2026-04-28' },
    { entityRef: 'target', key: 'Registered address', value: '5, avenue Gaston Diderich, L-1420 Luxembourg', as_of: '2026-04-28' },
  ],
};

/** YSolutions supplemental data: the softer KYC layer. */
export const YSOLUTIONS_ATTRIBUTES: RawAttribute[] = [
  { entityRef: 'bidco', key: 'Primary contact', value: 'Sophie Marchetti, Director — sophie.marchetti@halcyon-cap.example', as_of: '2026-05-20' },
  { entityRef: 'bidco', key: 'Source of funds', value: 'Equity contributions from Halcyon Holding S.à r.l. and senior acquisition financing from Nordbank AG.', as_of: '2026-05-20' },
  { entityRef: 'bidco', key: 'FATCA/CRS classification', value: 'Passive Non-Financial Entity (Passive NFE).', as_of: '2026-05-20' },
  { entityRef: 'topco', key: 'Tax residency', value: 'Germany (Munich tax office).', as_of: '2026-05-20' },
  { entityRef: 'ubo-brandt', key: 'Source of wealth', value: 'Proceeds from the 2018 sale of a family-owned logistics operator; subsequent real-estate investments.', as_of: '2026-05-20' },
  { entityRef: 'ubo-brandt', key: 'Role', value: 'Managing director of Halcyon Beteiligungs GmbH and ultimate beneficial owner.', as_of: '2026-05-20' },
  { entityRef: 'ubo-brandt', key: 'PEP status', value: 'Not a politically exposed person.', as_of: '2026-05-20' },
  { entityRef: 'ubo-andersson', key: 'Source of wealth', value: 'Career earnings and investment income; co-investor since 2021.', as_of: '2026-05-20' },
  { entityRef: 'ubo-andersson', key: 'PEP status', value: 'Not a politically exposed person.', as_of: '2026-05-20' },
];

/** Daysbetween, for the currency check. Pure so tests can pin "today". */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function currencyItems(today: string, staleDays: number): CurrencyItem[] {
  return QUANTIUM_STRUCTURE.entities.map((e) => {
    const ageDays = daysBetween(e.as_of, today);
    return { ref: e.ref, name: e.name, as_of: e.as_of, ageDays, stale: ageDays > staleDays };
  });
}
