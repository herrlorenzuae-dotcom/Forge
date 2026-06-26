/**
 * The ONE place the frontier model is called. Every engine module goes
 * through callStructured(), so name-masking and the audit log are
 * unskippable.
 *
 * Sequence: build the client's masking registry → sanitize system + user →
 * claude-opus-4-8 (structured output) → de-anonymize locally → write the
 * ai_calls audit row. Citation verification against the structure store
 * happens in the caller (it owns the fact lookups).
 *
 * Call rules for the Opus 4.x family: no temperature/top_p/top_k (sending
 * them 400s), structured output via messages.parse + output_config.format.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { config } from '../config.js';
import { getDb, genId } from '../db/db.js';
import { buildRegistry, sanitize, restore, type Registry } from '../privacy/anonymize.js';

export interface CallOptions<T> {
  /** e.g. 'intake.parse', 'mapping.answer' — shown in the privacy panel. */
  stage: string;
  system: string;
  /** RAW text — sanitized inside; never pre-mask. */
  user: string;
  schema: z.ZodType<T>;
  /** Scope name-masking to one client's structure. Omit when there is
   *  nothing client-specific to protect (e.g. parsing a blank questionnaire). */
  clientId?: string;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  /** Images to attach (e.g. a structure chart). NOTE: images cannot be
   *  name-masked — extracting a chart necessarily sends its names to the
   *  model. Use the deterministic Excel path when that is unacceptable. */
  images?: { mediaType: string; dataBase64: string }[];
}

export interface CallResult<T> {
  data: T;
  registry: Registry;
  durationMs: number;
  auditId: string;
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  if (!config.anthropic.apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. DealProof needs it to draft answers.');
  }
  _client = new Anthropic();
  return _client;
}

/** Inject a fake client (tests). Pass null to reset. */
export function setAnthropicClient(client: unknown): void {
  _client = client as Anthropic | null;
}

export function hasKey(): boolean {
  return Boolean(config.anthropic.apiKey);
}

export async function callStructured<T>(opts: CallOptions<T>): Promise<CallResult<T>> {
  const db = getDb();
  const started = Date.now();
  const auditId = genId('call');

  const registry = opts.clientId ? buildRegistry(opts.clientId) : { mappings: [] };
  const sys = sanitize(opts.system, registry);
  const usr = sanitize(opts.user, registry);
  const stats = { ...sys.stats };
  for (const [k, v] of Object.entries(usr.stats)) stats[k] = (stats[k] ?? 0) + v;

  const system =
    sys.sanitized +
    '\n\nNote: bracketed tokens like [ENTITY_1] or [PERSON_2] are protected references to real parties. ' +
    'Reproduce them exactly wherever you refer to that party — never alter, renumber, or invent such tokens.';
  const imageNote = opts.images?.length ? `\n\n[${opts.images.length} image(s) attached — NOT name-masked]` : '';
  const sanitizedPrompt = `SYSTEM:\n${system}\n\nUSER:\n${usr.sanitized}${imageNote}`;

  const writeAudit = (ok: boolean, inT: number, outT: number): void => {
    db.prepare(
      `INSERT INTO ai_calls (id, stage, model, sanitized_prompt, entity_stats_json, duration_ms, input_tokens, output_tokens, ok)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(auditId, opts.stage, config.anthropic.model, sanitizedPrompt, JSON.stringify(stats), Date.now() - started, inT, outT, ok ? 1 : 0);
  };

  try {
    const content = opts.images?.length
      ? [
          ...opts.images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: img.dataBase64 },
          })),
          { type: 'text' as const, text: usr.sanitized },
        ]
      : usr.sanitized;

    const response = await getClient().messages.parse({
      model: config.anthropic.model,
      max_tokens: opts.maxTokens ?? 4_000,
      system,
      messages: [{ role: 'user', content }],
      output_config: {
        format: zodOutputFormat(opts.schema),
        effort: opts.effort ?? 'high',
      },
    });

    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) {
      throw new Error(`Model returned unparseable output (stop_reason: ${response.stop_reason})`);
    }

    const restored = restore(parsed as T, registry);
    writeAudit(true, response.usage.input_tokens, response.usage.output_tokens);
    return { data: restored, registry, durationMs: Date.now() - started, auditId };
  } catch (err) {
    writeAudit(false, 0, 0);
    throw err;
  }
}
