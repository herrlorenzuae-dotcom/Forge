/**
 * On-device name masking. KYC data is the most sensitive a client holds —
 * entity names, the identities of beneficial owners. Before any text leaves
 * the machine for the frontier model, those names are replaced with reversible
 * placeholders built from the client's own structure (the source of truth for
 * who exists). Placeholders are restored locally on the way back.
 *
 * This is regex masking from the known registry: it catches every name the
 * structure knows. Names it has never seen (a counterparty typed into a
 * question) are not masked — the UI says so.
 */

import { getDb } from '../db/db.js';

export interface EntityMapping {
  placeholder: string;
  original: string;
}

export interface Registry {
  mappings: EntityMapping[];
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Build a reversible registry for one client: every entity name gets a
 *  placeholder. Individuals are PERSON, everything else ENTITY. */
export function buildRegistry(clientId: string): Registry {
  const db = getDb();
  const rows = db
    .prepare(`SELECT name, kind FROM entities WHERE client_id = ? ORDER BY length(name) DESC`)
    .all(clientId) as { name: string; kind: string }[];
  let ent = 0;
  let per = 0;
  const mappings: EntityMapping[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const original = norm(r.name);
    if (!original || seen.has(original.toLowerCase())) continue;
    seen.add(original.toLowerCase());
    const placeholder = r.kind === 'individual' ? `[PERSON_${++per}]` : `[ENTITY_${++ent}]`;
    mappings.push({ placeholder, original });
  }
  return { mappings };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace known names with placeholders. Longest names first so
 *  "Halcyon Holding S.à r.l." is masked before "Halcyon". */
export function sanitize(text: string, reg: Registry): { sanitized: string; stats: Record<string, number> } {
  let out = text;
  const stats: Record<string, number> = {};
  for (const m of reg.mappings) {
    const re = new RegExp(escapeRegExp(m.original), 'gi');
    let count = 0;
    out = out.replace(re, () => {
      count++;
      return m.placeholder;
    });
    if (count) stats[m.placeholder] = count;
  }
  return { sanitized: out, stats };
}

/** Restore placeholders to originals, anywhere in a string. */
export function restoreString(text: string, reg: Registry): string {
  let out = text;
  for (const m of reg.mappings) {
    out = out.split(m.placeholder).join(m.original);
  }
  return out;
}

/** Restore placeholders deep inside any JSON-ish value. */
export function restore<T>(value: T, reg: Registry): T {
  if (typeof value === 'string') return restoreString(value, reg) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => restore(v, reg)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = restore(v, reg);
    return out as T;
  }
  return value;
}
