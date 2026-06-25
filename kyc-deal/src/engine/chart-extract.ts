/**
 * Vision extraction of a delivered structure chart (PNG/JPG). The model reads
 * the chart image and returns entities + relationships, which are converted to
 * the same StructureSnapshot the connectors and the Excel importer produce —
 * so it flows through the identical reconciliation and review.
 *
 * Privacy note: a chart image cannot be name-masked. Extracting it sends the
 * image, with its real names, to the frontier model. The Excel path is the
 * local, non-sending alternative; this path is opt-in and warned about in the
 * UI. PowerPoint / Visio / Lucid charts are exported to an image and read the
 * same way.
 */

import { callStructured, hasKey } from '../ai/claude.js';
import { ChartSnapshotSchema } from '../ai/schemas.js';
import { coerceKind, coerceRole, slug } from '../connectors/excel.js';
import type { StructureSnapshot, RawEntity, RawEdge } from '../connectors/types.js';

const SUPPORTED: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export function mediaTypeFor(filenameOrMime: string): string | null {
  const lower = filenameOrMime.toLowerCase();
  if (lower.startsWith('image/')) return Object.values(SUPPORTED).includes(lower) ? lower : null;
  const ext = lower.split('.').pop() ?? '';
  return SUPPORTED[ext] ?? null;
}

export async function extractChartToSnapshot(clientId: string, imageBase64: string, mediaType: string, today = new Date().toISOString().slice(0, 10)): Promise<StructureSnapshot> {
  if (!hasKey()) throw new Error('ANTHROPIC_API_KEY is required to read a chart image. Use the Excel import for a local, no-send alternative.');

  const res = await callStructured({
    stage: 'import.chart',
    clientId,
    images: [{ mediaType, dataBase64: imageBase64 }],
    system:
      'You read corporate group structure charts. Extract every entity (box) and every connecting line. ' +
      'Distinguish economic ownership (a shareholding, usually labelled with a %) from control (voting majority, ' +
      'board control, a shareholders’ agreement, GP/manager role, or veto rights — often dashed or annotated). ' +
      'Read names exactly as written. Do not invent entities or links you cannot see.',
    user: 'Extract the full structure from this chart: every entity and every ownership/control relationship, with percentages and any control mechanisms.',
    schema: ChartSnapshotSchema,
    effort: 'high',
    maxTokens: 6_000,
  });

  // Names → refs; resolve edge endpoints by name (case-insensitive).
  const refByName = new Map<string, string>();
  const entities: RawEntity[] = res.data.entities.map((e) => {
    const ref = slug(e.name);
    refByName.set(e.name.toLowerCase().trim(), ref);
    return {
      ref,
      name: e.name,
      kind: coerceKind(e.kind),
      role: coerceRole(e.role),
      jurisdiction: e.jurisdiction,
      registration_no: e.registration_no,
      incorporation_date: '',
      status: 'active',
      as_of: today,
      notes: 'Extracted from structure chart',
    };
  });

  const edges: RawEdge[] = [];
  for (const e of res.data.edges) {
    const p = refByName.get(e.parentName.toLowerCase().trim());
    const c = refByName.get(e.childName.toLowerCase().trim());
    if (!p || !c) continue;
    edges.push({
      parentRef: p,
      childRef: c,
      pct: Number.isFinite(e.percent) ? e.percent : 0,
      kind: e.type === 'control' ? 'control' : 'shares',
      mechanism: e.mechanism ?? '',
      as_of: today,
    });
  }

  return { entities, edges, ubos: [], attributes: [] };
}
