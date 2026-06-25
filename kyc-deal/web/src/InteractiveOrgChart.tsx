import { useMemo, useState } from 'react';
import type { OrgNode, OrgEdge } from './api.js';

/**
 * Interactive org chart rendered as SVG in the Forge design language.
 *  • click a node  → focus only its strand (ancestors + descendants)
 *  • click an edge → scenario: change the % and see effective ownership
 *                     recomputed live downstream (non-destructive)
 * Layout is a small layered (Sugiyama-style) top-down placement with a
 * barycenter crossing-reduction pass — no external graph dependency.
 */

const BOX_W = 188;
const BOX_H = 64;
const COL = 224; // horizontal step
const ROW = 150; // vertical step
const PAD = 48;

const ek = (e: { parent: string; child: string }) => `${e.parent}->${e.child}`;

type Pos = { x: number; y: number };

function layout(nodes: OrgNode[], edges: OrgEdge[]): { pos: Map<string, Pos>; w: number; h: number } {
  const ids = nodes.map((n) => n.id);
  const idset = new Set(ids);
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  ids.forEach((id) => {
    parents.set(id, []);
    children.set(id, []);
  });
  edges.forEach((e) => {
    if (!idset.has(e.parent) || !idset.has(e.child)) return;
    children.get(e.parent)!.push(e.child);
    parents.get(e.child)!.push(e.parent);
  });

  // depth = longest path from a root (relaxation, cycle-safe)
  const depth = new Map<string, number>();
  ids.forEach((id) => depth.set(id, 0));
  for (let i = 0; i < ids.length; i++) {
    let changed = false;
    edges.forEach((e) => {
      if (!idset.has(e.parent) || !idset.has(e.child)) return;
      const d = depth.get(e.parent)! + 1;
      if (d > depth.get(e.child)!) {
        depth.set(e.child, d);
        changed = true;
      }
    });
    if (!changed) break;
  }

  const maxD = Math.max(0, ...ids.map((id) => depth.get(id)!));
  const layers: string[][] = Array.from({ length: maxD + 1 }, () => []);
  // keep input order as the initial within-layer order
  ids.forEach((id) => layers[depth.get(id)!].push(id));

  const orderIndex = (layer: string[]) => {
    const m = new Map<string, number>();
    layer.forEach((id, i) => m.set(id, i));
    return m;
  };
  const bary = (id: string, neigh: Map<string, string[]>, idx: Map<string, number>) => {
    const ns = neigh.get(id)!.filter((n) => idx.has(n));
    if (!ns.length) return Number.POSITIVE_INFINITY;
    return ns.reduce((s, n) => s + idx.get(n)!, 0) / ns.length;
  };
  for (let pass = 0; pass < 4; pass++) {
    for (let d = 1; d <= maxD; d++) {
      const idx = orderIndex(layers[d - 1]);
      layers[d].sort((a, b) => bary(a, parents, idx) - bary(b, parents, idx));
    }
    for (let d = maxD - 1; d >= 0; d--) {
      const idx = orderIndex(layers[d + 1]);
      layers[d].sort((a, b) => bary(a, children, idx) - bary(b, children, idx));
    }
  }

  const widest = Math.max(1, ...layers.map((l) => l.length));
  const pos = new Map<string, Pos>();
  layers.forEach((layer, d) => {
    const offset = ((widest - layer.length) * COL) / 2;
    layer.forEach((id, i) => pos.set(id, { x: PAD + offset + i * COL, y: PAD + d * ROW }));
  });
  return { pos, w: PAD * 2 + widest * COL, h: PAD * 2 + (maxD + 1) * ROW };
}

/** Effective (multiplied) ownership from the roots, given % overrides. */
function effective(nodes: OrgNode[], edges: OrgEdge[], overrides: Map<string, number>): Map<string, number> {
  const ids = nodes.map((n) => n.id);
  const idset = new Set(ids);
  // root = no incoming edge at all (true top); economic sum ignores control edges
  const incomingAll = new Map<string, OrgEdge[]>();
  const incomingEcon = new Map<string, OrgEdge[]>();
  ids.forEach((id) => (incomingAll.set(id, []), incomingEcon.set(id, [])));
  edges.forEach((e) => {
    if (!idset.has(e.parent) || !idset.has(e.child)) return;
    incomingAll.get(e.child)!.push(e);
    if (e.kind !== 'control') incomingEcon.get(e.child)!.push(e);
  });
  const roots = new Set(ids.filter((id) => incomingAll.get(id)!.length === 0));
  const eff = new Map<string, number>();
  const visiting = new Set<string>();
  const calc = (id: string): number => {
    if (eff.has(id)) return eff.get(id)!;
    if (roots.has(id)) {
      eff.set(id, 100);
      return 100;
    }
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    let total = 0;
    for (const e of incomingEcon.get(id)!) {
      const pct = overrides.has(ek(e)) ? overrides.get(ek(e))! : e.pct;
      total += (calc(e.parent) * pct) / 100;
    }
    visiting.delete(id);
    eff.set(id, total);
    return total;
  };
  ids.forEach(calc);
  return eff;
}

function strand(focus: string, edges: OrgEdge[]): Set<string> {
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  edges.forEach((e) => {
    (up.get(e.child) ?? up.set(e.child, []).get(e.child)!).push(e.parent);
    (down.get(e.parent) ?? down.set(e.parent, []).get(e.parent)!).push(e.child);
  });
  const out = new Set<string>([focus]);
  const walk = (start: string, m: Map<string, string[]>) => {
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const n of m.get(cur) ?? []) if (!out.has(n)) (out.add(n), stack.push(n));
    }
  };
  walk(focus, up);
  walk(focus, down);
  return out;
}

const fmtPct = (p: number) => (Number.isInteger(p) ? `${p}` : p.toFixed(2)).replace('.', ',') + ' %';

const EMBER = '#7d2f3f';
const VERDANT = '#1f5f3c';
const FOG = '#6d6a63';
const INK = '#1b1a18';

function accent(role: string): string {
  if (role === 'ubo' || role === 'acquisition_vehicle') return EMBER;
  if (role === 'target') return VERDANT;
  return '#cabfb0';
}

export function InteractiveOrgChart({ nodes, edges }: { nodes: OrgNode[]; edges: OrgEdge[] }) {
  const [focus, setFocus] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [zoom, setZoom] = useState(1);

  const nameOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.name])), [nodes]);

  const visible = useMemo(() => (focus ? strand(focus, edges) : new Set(nodes.map((n) => n.id))), [focus, edges, nodes]);
  const vNodes = useMemo(() => nodes.filter((n) => visible.has(n.id)), [nodes, visible]);
  const vEdges = useMemo(() => edges.filter((e) => visible.has(e.parent) && visible.has(e.child)), [edges, visible]);

  const { pos, w, h } = useMemo(() => layout(vNodes, vEdges), [vNodes, vEdges]);
  const baseEff = useMemo(() => effective(nodes, edges, new Map()), [nodes, edges]);
  const scenEff = useMemo(() => effective(nodes, edges, overrides), [nodes, edges, overrides]);
  const scenarioOn = overrides.size > 0;

  const selectedEdgeObj = selEdge ? edges.find((e) => ek(e) === selEdge) : null;

  const applyScenario = () => {
    if (!selectedEdgeObj) return;
    const v = parseFloat(draft.replace(',', '.'));
    if (!Number.isFinite(v) || v < 0 || v > 100) return;
    setOverrides((m) => new Map(m).set(selEdge!, v));
    setSelEdge(null);
  };

  return (
    <div>
      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
        {focus ? (
          <button className="rounded-full border border-black/15 bg-surface px-3 py-1 text-bone hover:border-ember/40" onClick={() => setFocus(null)}>
            ← Ganze Struktur
          </button>
        ) : (
          <span className="text-fog">Tipp: Knoten anklicken = nur dieser Strang · Kante anklicken = Szenario (% ändern)</span>
        )}
        {focus && <span className="text-fog">Strang: <span className="text-bone">{nameOf.get(focus)}</span> ({vNodes.length} Gesellschaften)</span>}
        <span className="ml-auto flex items-center gap-1">
          <button className="h-6 w-6 rounded border border-black/15 bg-surface text-bone" onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}>−</button>
          <span className="w-10 text-center text-fog">{Math.round(zoom * 100)}%</span>
          <button className="h-6 w-6 rounded border border-black/15 bg-surface text-bone" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>+</button>
        </span>
      </div>

      {/* scenario banner */}
      {scenarioOn && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-warn/30 bg-warn/[0.06] px-3 py-2 text-[11px] text-warn">
          <span>
            Szenario aktiv — {overrides.size} Beteiligung(en) geändert. Effektive Quoten unten zeigen <b>Ist → Szenario</b>; nichts wird gespeichert.
          </span>
          <button className="ml-auto rounded-full border border-warn/40 px-2 py-0.5 hover:bg-warn/10" onClick={() => setOverrides(new Map())}>
            Szenario zurücksetzen
          </button>
        </div>
      )}

      {/* edge editor */}
      {selectedEdgeObj && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-ember/30 bg-ember/[0.04] px-3 py-2 text-[11px]">
          <span className="text-bone">
            {nameOf.get(selectedEdgeObj.parent)} → {nameOf.get(selectedEdgeObj.child)}
          </span>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyScenario()}
            className="w-20 rounded border border-black/20 bg-surface px-2 py-0.5 font-mono text-bone"
            placeholder="z. B. 51"
          />
          <span className="text-fog">%</span>
          <button className="rounded-full bg-ember px-3 py-0.5 text-white" onClick={applyScenario}>Anwenden</button>
          <button className="rounded-full border border-black/15 px-3 py-0.5 text-fog" onClick={() => setSelEdge(null)}>Abbrechen</button>
        </div>
      )}

      <div className="overflow-auto rounded-lg border border-black/[0.06] bg-[#faf9f6]" style={{ maxHeight: 620 }}>
        <svg width={w * zoom} height={h * zoom} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', fontFamily: "'Schibsted Grotesk', system-ui, sans-serif" }}>
          <defs>
            <marker id="arrow" markerWidth="9" markerHeight="9" refX="6" refY="4.5" orient="auto">
              <path d="M0,0 L8,4.5 L0,9 Z" fill={FOG} />
            </marker>
          </defs>

          {/* edges */}
          {vEdges.map((e) => {
            const a = pos.get(e.parent)!;
            const b = pos.get(e.child)!;
            if (!a || !b) return null;
            const x1 = a.x + BOX_W / 2;
            const y1 = a.y + BOX_H;
            const x2 = b.x + BOX_W / 2;
            const y2 = b.y;
            const my = (y1 + y2) / 2;
            const control = e.kind === 'control';
            const pct = overrides.has(ek(e)) ? overrides.get(ek(e))! : e.pct;
            const changed = overrides.has(ek(e));
            const sel = selEdge === ek(e);
            return (
              <g key={ek(e)} className="cursor-pointer" onClick={() => { setSelEdge(ek(e)); setDraft(String(pct).replace('.', ',')); }}>
                <path
                  d={`M${x1},${y1} L${x1},${my} L${x2},${my} L${x2},${y2}`}
                  fill="none"
                  stroke={changed || sel ? EMBER : FOG}
                  strokeWidth={changed || sel ? 2 : 1.3}
                  strokeDasharray={control ? '5 3' : undefined}
                  markerEnd="url(#arrow)"
                />
                {(pct > 0 || control) && (
                  <g transform={`translate(${(x1 + x2) / 2}, ${my})`}>
                    <rect x={-22} y={-8} width={44} height={16} rx={3} fill="#faf9f6" />
                    <text textAnchor="middle" dy={4} fontSize={10.5} fill={changed ? EMBER : INK} fontWeight={changed ? 700 : 400}>
                      {control ? 'Kontrolle' : fmtPct(pct)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* nodes */}
          {vNodes.map((n) => {
            const p = pos.get(n.id)!;
            if (!p) return null;
            const be = baseEff.get(n.id) ?? 0;
            const se = scenEff.get(n.id) ?? 0;
            const effChanged = scenarioOn && Math.abs(be - se) > 0.01;
            const ac = accent(n.role);
            return (
              <g key={n.id} className="cursor-pointer" onClick={() => setFocus(n.id)}>
                <rect x={p.x + 2} y={p.y + 3} width={BOX_W} height={BOX_H} rx={6} fill="rgba(0,0,0,0.06)" />
                <rect x={p.x} y={p.y} width={BOX_W} height={BOX_H} rx={6} fill="#ffffff" stroke={effChanged ? EMBER : 'rgba(0,0,0,0.16)'} strokeWidth={effChanged ? 2 : 1} />
                <rect x={p.x} y={p.y} width={5} height={BOX_H} rx={2} fill={ac} />
                <foreignObject x={p.x + 12} y={p.y + 7} width={BOX_W - 20} height={BOX_H - 30}>
                  <div style={{ fontFamily: "'Libre Caslon Display', Georgia, serif", fontSize: 11.5, lineHeight: 1.15, color: INK, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {n.name}
                  </div>
                </foreignObject>
                <text x={p.x + 12} y={p.y + BOX_H - 9} fontSize={9} fill={FOG}>
                  {n.jurisdiction || n.kind}
                </text>
                {scenarioOn && (
                  <text x={p.x + BOX_W - 8} y={p.y + BOX_H - 9} fontSize={9} textAnchor="end" fill={effChanged ? EMBER : FOG} fontWeight={effChanged ? 700 : 400}>
                    {effChanged ? `${fmtPct(be)}→${fmtPct(se)}` : fmtPct(se)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
