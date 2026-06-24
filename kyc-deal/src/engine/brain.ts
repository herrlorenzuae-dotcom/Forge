/**
 * The KYC Brain. Every finalized answer is folded into a library keyed by the
 * normalized question. As the corpus grows, recurring questions accumulate
 * the same value again and again — optionality (the count of distinct
 * answers) stays low and convergence (the dominant answer's share) climbs. So
 * the more questionnaires a client has answered, the more the next one
 * answers itself.
 */

import { getDb, genId } from '../db/db.js';
import type { BrainOption } from '../types.js';

const STOP = new Set([
  'the', 'a', 'an', 'of', 'for', 'to', 'is', 'are', 'please', 'kindly', 'provide', 'state',
  'your', 'you', 'and', 'or', 'in', 'on', 'with', 'this', 'that', 'any', 'each', 'all', 'we',
  'do', 'does', 'has', 'have', 'what', 'which', 'name', 'list',
]);

/** Collapse trivial differences in phrasing so "Please state the LEI of the
 *  entity" and "Provide the entity's LEI" land on the same key. */
export function normalizeQuestion(prompt: string): string {
  const tokens = prompt
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
  return tokens.sort().join(' ').trim();
}

interface Variant {
  value: string;
  count: number;
}

function parseVariants(json: string): Variant[] {
  try {
    const v = JSON.parse(json) as Variant[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function variantsToOptions(variants: Variant[]): BrainOption[] {
  const total = variants.reduce((s, v) => s + v.count, 0) || 1;
  return [...variants]
    .sort((a, b) => b.count - a.count)
    .map((v) => ({ value: v.value, timesUsed: v.count, share: v.count / total }));
}

/** Prior answers to a question, most-used first. */
export function getBrainOptions(prompt: string): BrainOption[] {
  const db = getDb();
  const norm = normalizeQuestion(prompt);
  const row = db.prepare(`SELECT variants_json FROM answer_library WHERE question_norm = ?`).get(norm) as { variants_json: string } | undefined;
  if (!row) return [];
  return variantsToOptions(parseVariants(row.variants_json));
}

/** Fold a finalized answer into the library. */
export function recordFinalizedAnswer(prompt: string, kind: string, value: string): void {
  const v = value.trim();
  if (!v) return;
  const db = getDb();
  const norm = normalizeQuestion(prompt);
  const row = db.prepare(`SELECT id, variants_json, times_used FROM answer_library WHERE question_norm = ?`).get(norm) as
    | { id: string; variants_json: string; times_used: number }
    | undefined;

  if (!row) {
    const variants: Variant[] = [{ value: v, count: 1 }];
    db.prepare(
      `INSERT INTO answer_library (id, question_norm, sample_prompt, question_kind, variants_json, times_used, last_used)
       VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`,
    ).run(genId('lib'), norm, prompt.trim(), kind, JSON.stringify(variants));
    return;
  }

  const variants = parseVariants(row.variants_json);
  const key = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const existing = variants.find((x) => key(x.value) === key(v));
  if (existing) existing.count++;
  else variants.push({ value: v, count: 1 });
  db.prepare(`UPDATE answer_library SET variants_json = ?, times_used = times_used + 1, last_used = datetime('now') WHERE id = ?`).run(
    JSON.stringify(variants),
    row.id,
  );
}

export interface BrainEntry {
  id: string;
  prompt: string;
  kind: string;
  timesUsed: number;
  optionality: number; // distinct answers seen
  dominantShare: number; // share of the most common answer
  options: BrainOption[];
  lastUsed: string;
}

export function listBrain(): BrainEntry[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id, sample_prompt, question_kind, variants_json, times_used, last_used FROM answer_library ORDER BY times_used DESC, last_used DESC`)
    .all() as { id: string; sample_prompt: string; question_kind: string; variants_json: string; times_used: number; last_used: string }[];
  return rows.map((r) => {
    const options = variantsToOptions(parseVariants(r.variants_json));
    return {
      id: r.id,
      prompt: r.sample_prompt,
      kind: r.question_kind,
      timesUsed: r.times_used,
      optionality: options.length,
      dominantShare: options[0]?.share ?? 0,
      options,
      lastUsed: r.last_used,
    };
  });
}

export interface BrainStats {
  questions: number;
  finalizedAnswers: number;
  settled: number; // questions with a single dominant answer (optionality 1)
  avgOptionality: number;
}

export function brainStats(): BrainStats {
  const entries = listBrain();
  const questions = entries.length;
  const finalizedAnswers = entries.reduce((s, e) => s + e.timesUsed, 0);
  const settled = entries.filter((e) => e.optionality === 1 && e.timesUsed > 1).length;
  const avgOptionality = questions ? entries.reduce((s, e) => s + e.optionality, 0) / questions : 0;
  return { questions, finalizedAnswers, settled, avgOptionality };
}
