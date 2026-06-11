/**
 * The doodle pad. An easter egg for the long drafting runs: a small,
 * well-made drawing surface in the corner. Crisp at any pixel density,
 * undo that works, the house palette as ink, and your masterpiece
 * survives a reload. Entirely local, like everything else here.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

interface Stroke {
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
}

const INKS = [
  { name: 'Ink', value: '#1b1a18' },
  { name: 'Bordeaux', value: '#7d2f3f' },
  { name: 'Forest', value: '#1f5f3c' },
  { name: 'Ochre', value: '#8f6a08' },
];

const WIDTHS = [2, 4, 8];

const PROMPTS = [
  'Draw your ideal fund.',
  'Sketch the waterfall. Any waterfall.',
  'Draw the LP of your dreams.',
  'Diagram the org chart from memory.',
  'Draw opposing counsel as a sea creature.',
  'Chart your billables as a landscape.',
  'Draw the closing dinner.',
];

const STORE_KEY = 'forge-doodle';
const CANVAS_W = 384;
const CANVAS_H = 288;

function loadStrokes(): Stroke[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Stroke[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function Doodle() {
  const [open, setOpen] = useState(false);
  const [ink, setInk] = useState(INKS[1].value);
  const [width, setWidth] = useState(WIDTHS[1]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>(loadStrokes());
  const liveRef = useRef<Stroke | null>(null);
  const [, bump] = useState(0); // re-render for the undo/clear button states

  const prompt = useMemo(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)], [open]);

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== CANVAS_W * dpr) {
      canvas.width = CANVAS_W * dpr;
      canvas.height = CANVAS_H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const paint = (s: Stroke) => {
      if (s.points.length === 0) return;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      const pts = s.points;
      ctx.moveTo(pts[0].x, pts[0].y);
      if (pts.length < 3) {
        ctx.lineTo(pts[pts.length - 1].x + 0.01, pts[pts.length - 1].y + 0.01);
      } else {
        // midpoint smoothing: quadratic through the midpoints reads as a
        // confident pen line rather than a polyline
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i + 1].x) / 2;
          const my = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
      }
      ctx.stroke();
    };
    for (const s of strokesRef.current) paint(s);
    if (liveRef.current) paint(liveRef.current);
  };

  useEffect(() => {
    if (open) redraw();
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const persist = () => {
    try {
      // keep the keepsake under control: oldest strokes yield first
      let strokes = strokesRef.current;
      let json = JSON.stringify(strokes);
      while (json.length > 200_000 && strokes.length > 1) {
        strokes = strokes.slice(1);
        json = JSON.stringify(strokes);
      }
      strokesRef.current = strokes;
      localStorage.setItem(STORE_KEY, json);
    } catch {
      /* a full localStorage must never break drawing */
    }
  };

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const down = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    liveRef.current = { color: ink, width, points: [pos(e)] };
    redraw();
  };

  const move = (e: React.PointerEvent) => {
    if (!liveRef.current) return;
    liveRef.current.points.push(pos(e));
    redraw();
  };

  const up = () => {
    if (!liveRef.current) return;
    strokesRef.current = [...strokesRef.current, liveRef.current];
    liveRef.current = null;
    persist();
    redraw();
    bump((n) => n + 1);
  };

  const undo = () => {
    strokesRef.current = strokesRef.current.slice(0, -1);
    persist();
    redraw();
    bump((n) => n + 1);
  };

  const clear = () => {
    strokesRef.current = [];
    persist();
    redraw();
    bump((n) => n + 1);
  };

  const frame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // compose onto paper so the download isn't transparent
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#f4f3ef';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = 'my-ideal-fund.png';
    a.click();
  };

  const empty = strokesRef.current.length === 0;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="The doodle pad. For the long drafting runs."
          aria-label="Open the doodle pad"
          className="group fixed bottom-6 left-6 z-30 flex h-14 w-14 items-center justify-center rounded-full border border-black/[0.08] bg-surface shadow-[0_2px_6px_rgba(27,26,24,0.08),0_12px_32px_rgba(27,26,24,0.16)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_4px_10px_rgba(27,26,24,0.1),0_20px_48px_rgba(27,26,24,0.22)] active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-bone transition-transform duration-300 group-hover:-rotate-12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            <path d="M2 2l7.586 7.586" />
            <circle cx="11" cy="11" r="2" />
          </svg>
        </button>
      )}

      {open && (
        <div className="animate-pop-in fixed bottom-6 left-6 z-30 w-[26rem] max-w-[calc(100vw-3rem)] overflow-hidden rounded-3xl border border-black/[0.08] bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_6px_rgba(27,26,24,0.06),0_24px_60px_rgba(27,26,24,0.18),0_64px_140px_rgba(27,26,24,0.22)]">
          <div className="glass hairline-b flex items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="font-display text-lg text-bone">{prompt}</div>
              <div className="text-[11px] text-fog">For the long drafting runs. Stays on this machine, obviously.</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-xs text-fog transition-all hover:rotate-90 hover:bg-black/10 hover:text-bone"
            >
              ✕
            </button>
          </div>

          <div className="p-4">
            <canvas
              ref={canvasRef}
              style={{ width: CANVAS_W, height: CANVAS_H, touchAction: 'none' }}
              className="block cursor-crosshair rounded-2xl border border-black/[0.07] bg-page shadow-[inset_0_1px_3px_rgba(27,26,24,0.05)]"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerLeave={up}
            />
            <div className="mt-3 flex items-center gap-2">
              {INKS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setInk(c.value)}
                  title={c.name}
                  aria-label={`${c.name} ink`}
                  className={`h-6 w-6 rounded-full border transition-transform ${ink === c.value ? 'scale-110 border-black/30 ring-2 ring-black/10 ring-offset-2 ring-offset-surface' : 'border-black/10 hover:scale-105'}`}
                  style={{ background: c.value }}
                />
              ))}
              <span className="mx-1 h-5 w-px bg-black/10" />
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  onClick={() => setWidth(w)}
                  title={`${w}px nib`}
                  aria-label={`${w} pixel nib`}
                  className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${width === w ? 'bg-black/[0.08]' : 'hover:bg-black/[0.04]'}`}
                >
                  <span className="rounded-full bg-bone" style={{ width: w + 2, height: w + 2 }} />
                </button>
              ))}
              <span className="ml-auto flex items-center gap-1.5">
                <button onClick={undo} disabled={empty} className="btn-ghost px-3 py-1 text-[11px] disabled:opacity-40" title="Undo (⌘Z)">
                  Undo
                </button>
                <button onClick={clear} disabled={empty} className="btn-ghost px-3 py-1 text-[11px] disabled:opacity-40">
                  Clear
                </button>
                <button onClick={frame} disabled={empty} className="btn-ghost px-3 py-1 text-[11px] disabled:opacity-40" title="Download as PNG">
                  Frame it
                </button>
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
