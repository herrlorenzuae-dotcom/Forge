/**
 * Citation verification — the trust core. An answer may only rest on facts
 * that exist in the structure store, and the quote it relies on must appear
 * verbatim in that fact. The model speaks in masked placeholders; we restore
 * the quote locally before checking, so a masked name still verifies against
 * the real underlying value.
 */

import { getDb } from '../db/db.js';
import { restoreString, type Registry } from '../privacy/anonymize.js';
import type { Citation } from '../types.js';

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[‘’“”]/g, "'").trim();

/** The verbatim text behind a fact, by type + id. Empty string if missing. */
export function factText(factType: Citation['factType'], factId: string): string {
  const db = getDb();
  switch (factType) {
    case 'attribute': {
      const r = db.prepare(`SELECT key, value FROM entity_attributes WHERE id = ?`).get(factId) as { key: string; value: string } | undefined;
      return r ? `${r.key}: ${r.value}` : '';
    }
    case 'entity': {
      const r = db.prepare(`SELECT name, kind, role, jurisdiction, registration_no, incorporation_date, status FROM entities WHERE id = ?`).get(factId) as
        | { name: string; kind: string; role: string; jurisdiction: string; registration_no: string; incorporation_date: string; status: string }
        | undefined;
      return r ? `${r.name} ${r.kind} ${r.role} ${r.jurisdiction} ${r.registration_no} ${r.incorporation_date} ${r.status}` : '';
    }
    case 'edge': {
      const r = db
        .prepare(
          `SELECT p.name AS parent, c.name AS child, e.pct, e.kind FROM ownership_edges e
           JOIN entities p ON p.id = e.parent_id JOIN entities c ON c.id = e.child_id WHERE e.id = ?`,
        )
        .get(factId) as { parent: string; child: string; pct: number; kind: string } | undefined;
      return r ? `${r.parent} owns ${r.pct}% of ${r.child} (${r.kind})` : '';
    }
    case 'ubo': {
      const r = db
        .prepare(`SELECT en.name AS name, u.basis, u.pct, u.pep, u.residence FROM ubos u JOIN entities en ON en.id = u.entity_id WHERE u.id = ?`)
        .get(factId) as { name: string; basis: string; pct: number; pep: number; residence: string } | undefined;
      return r ? `${r.name} ${r.basis} ${r.pct}% ${r.pep ? 'PEP' : 'not PEP'} ${r.residence}` : '';
    }
    default:
      return '';
  }
}

/** Mark each citation verified/not, and return counts. */
export function verifyCitations(citations: Citation[], registry: Registry): { citations: Citation[]; total: number; verified: number } {
  let verified = 0;
  const out = citations.map((c) => {
    const fact = factText(c.factType, c.factId);
    const quote = normalize(restoreString(c.quote ?? '', registry));
    const ok = Boolean(fact) && quote.length > 0 && normalize(fact).includes(quote);
    if (ok) verified++;
    return { ...c, verified: ok };
  });
  return { citations: out, total: out.length, verified };
}
