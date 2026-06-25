/**
 * Organisation chart, derived deterministically from the stored structure.
 * No model call — it is a pure projection of entities + ownership edges, so
 * the same structure always renders the same chart. Emits a Mermaid
 * flowchart string for the UI plus a plain node/edge list as a fallback.
 */

import { getStructure } from './structure.js';
import type { EntityRole } from '../types.js';

export interface OrgNode {
  id: string;
  name: string;
  kind: string;
  role: EntityRole;
  jurisdiction: string;
}

export interface OrgEdge {
  parent: string;
  child: string;
  pct: number;
  kind: string;
  mechanism: string;
}

export interface OrgChart {
  mermaid: string;
  nodes: OrgNode[];
  edges: OrgEdge[];
}

const ROLE_LABEL: Record<EntityRole, string> = {
  ubo: 'UBO',
  topco: 'TopCo',
  intermediate: 'Holding',
  acquisition_vehicle: 'BidCo',
  target: 'Target',
  other: '',
};

/** Stable, mermaid-safe node id from an array index. */
const nid = (i: number) => `n${i}`;

function pctLabel(pct: number): string {
  if (!pct) return '';
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
}

export function buildOrgChart(clientId: string): OrgChart {
  const { entities, edges } = getStructure(clientId);
  // deterministic order: by role rank, then name
  const roleRank: Record<EntityRole, number> = { ubo: 0, topco: 1, intermediate: 2, acquisition_vehicle: 3, target: 4, other: 5 };
  const sorted = [...entities].sort((a, b) => roleRank[a.role] - roleRank[b.role] || a.name.localeCompare(b.name));
  const idToIdx = new Map<string, number>();
  sorted.forEach((e, i) => idToIdx.set(e.id, i));

  const nodes: OrgNode[] = sorted.map((e) => ({ id: e.id, name: e.name, kind: e.kind, role: e.role, jurisdiction: e.jurisdiction }));
  const orgEdges: OrgEdge[] = [...edges]
    .filter((e) => idToIdx.has(e.parent_id) && idToIdx.has(e.child_id))
    .sort((a, b) => (idToIdx.get(a.parent_id)! - idToIdx.get(b.parent_id)!) || (idToIdx.get(a.child_id)! - idToIdx.get(b.child_id)!))
    .map((e) => ({ parent: e.parent_id, child: e.child_id, pct: e.pct, kind: e.kind, mechanism: e.mechanism }));

  // ── Mermaid ──
  const lines: string[] = ['flowchart TD'];
  for (const e of sorted) {
    const i = idToIdx.get(e.id)!;
    const tag = ROLE_LABEL[e.role] ? `${ROLE_LABEL[e.role]} · ` : '';
    const juris = e.jurisdiction ? ` (${e.jurisdiction})` : '';
    const label = `${tag}${e.name}${juris}`.replace(/"/g, "'");
    // individuals as rounded, entities as boxes
    lines.push(e.kind === 'individual' ? `  ${nid(i)}(["${label}"])` : `  ${nid(i)}["${label}"]`);
  }
  // ownership edges are solid with a % label; control edges are dashed and
  // labelled with their mechanism, so the bank can read the control structure
  // distinctly from the cash-flow ownership.
  const controlLinks: number[] = [];
  orgEdges.forEach((e, linkIdx) => {
    const p = nid(idToIdx.get(e.parent)!);
    const c = nid(idToIdx.get(e.child)!);
    if (e.kind === 'control') {
      const lbl = (e.mechanism || 'control').replace(/"/g, "'");
      lines.push(`  ${p} -. "${lbl}" .-> ${c}`);
      controlLinks.push(linkIdx);
    } else {
      const lbl = pctLabel(e.pct);
      lines.push(lbl ? `  ${p} -- "${lbl}" --> ${c}` : `  ${p} --> ${c}`);
    }
  });
  // class styling by role
  const byClass: Record<string, number[]> = {};
  sorted.forEach((e, i) => {
    (byClass[e.role] ??= []).push(i);
  });
  lines.push('  classDef ubo fill:#f3e7ea,stroke:#7d2f3f,color:#1b1a18;');
  lines.push('  classDef acquisition_vehicle fill:#fff,stroke:#7d2f3f,stroke-width:2px,color:#1b1a18;');
  lines.push('  classDef target fill:#e9f1ec,stroke:#1f5f3c,color:#1b1a18;');
  lines.push('  classDef topco fill:#fdfcfa,stroke:#6d6a63,color:#1b1a18;');
  lines.push('  classDef intermediate fill:#fdfcfa,stroke:#cabfb0,color:#1b1a18;');
  for (const [role, idxs] of Object.entries(byClass)) {
    if (role === 'other') continue;
    lines.push(`  class ${idxs.map(nid).join(',')} ${role};`);
  }
  if (controlLinks.length) {
    lines.push(`  linkStyle ${controlLinks.join(',')} stroke:#7d2f3f,stroke-width:1.5px,stroke-dasharray:5 4;`);
  }

  return { mermaid: lines.join('\n'), nodes, edges: orgEdges };
}
