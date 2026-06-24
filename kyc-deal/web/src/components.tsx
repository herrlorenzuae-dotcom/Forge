import { useEffect, useState } from 'react';
import { get, type Citation, type Health } from './api.js';

export function SectionTitle({ children, sub, eyebrow }: { children: React.ReactNode; sub?: string; eyebrow?: string }) {
  return (
    <div className="mb-10">
      {eyebrow && (
        <p className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">
          <span className="inline-block h-px w-6 bg-ember/60" />
          {eyebrow}
        </p>
      )}
      <h1 className="font-display text-[2.5rem] leading-[1.05] tracking-[-0.01em] text-bone md:text-[3.1rem]">{children}</h1>
      {sub && <p className="mt-3.5 max-w-2xl text-base leading-relaxed text-fog">{sub}</p>}
    </div>
  );
}

export function Button({ children, onClick, disabled, busy }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled || busy} className="btn">
      {busy && <span className="spinner" />}
      {busy ? 'Working' : children}
    </button>
  );
}

export function GhostButton({ children, onClick, disabled, busy }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled || busy} className="btn-ghost">
      {busy && <span className="spinner spinner-light h-3 w-3" />}
      {children}
    </button>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="animate-pop-in mt-3 rounded-xl border border-warn/30 bg-warn/[0.07] px-4 py-2.5 text-xs text-warn">{error}</p>;
}

export function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'ember' | 'verdant' | 'warn' }) {
  const tones: Record<string, string> = {
    neutral: 'border-black/10 bg-black/[0.03] text-fog',
    ember: 'border-ember/30 bg-ember/[0.07] text-ember',
    verdant: 'border-verdant/30 bg-verdant/[0.08] text-verdant',
    warn: 'border-warn/30 bg-warn/[0.08] text-warn',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tone = pct >= 80 ? 'bg-verdant' : pct >= 50 ? 'bg-ember' : 'bg-warn';
  return (
    <span className="inline-flex items-center gap-2" title={`${pct}% confidence`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-black/[0.07]">
        <span className={`block h-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-[10px] tabular-nums text-fog">{pct}%</span>
    </span>
  );
}

// ── StatusBadge: connector + key health ──
export function StatusBadge() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => get<Health>('/health').then((h) => alive && setHealth(h)).catch(() => alive && setHealth(null));
    poll();
    const t = setInterval(poll, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!health) return <span className="text-xs text-fog">connecting…</span>;
  const live = health.anthropicKey;
  return (
    <span
      className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-black/[0.08] bg-surface px-3.5 py-1.5 text-xs font-medium text-fog shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
      title={live ? `Model ${health.model} ready · connector: ${health.connector}` : `No model key — the KYC Brain still answers from the corpus. Connector: ${health.connector}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${live ? 'animate-ping bg-verdant' : 'bg-warn'}`} />
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${live ? 'bg-verdant' : 'bg-warn'}`} />
      </span>
      {live ? 'Model ready' : 'Brain-only'}
    </span>
  );
}

export function PrivacyButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-ghost whitespace-nowrap" title="See exactly what left your machine — every frontier call, with names masked on-device.">
      <span className="inline-block h-2 w-2 animate-breathe rounded-full bg-verdant" />
      Privacy
    </button>
  );
}

// ── CitationChip ──
export function CitationChip({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);
  const ok = citation.verified !== false;
  return (
    <span className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] tracking-tight transition-all duration-200 hover:-translate-y-px ${
          ok ? 'border-black/10 bg-black/[0.03] text-fog hover:border-ember/50 hover:text-ember' : 'border-warn/40 bg-warn/[0.06] text-warn'
        }`}
        title={ok ? 'Citation verified verbatim against the structure' : 'Quote NOT found in the cited fact'}
      >
        {citation.factType}:{citation.factId.slice(-4)} {ok ? '✓' : '✗'}
      </button>
      {open && (
        <span className="animate-pop-in absolute left-0 top-full z-30 mt-2 block w-72 rounded-2xl border border-black/[0.08] bg-surface p-4 text-xs leading-relaxed text-bone shadow-[0_4px_12px_rgba(0,0,0,0.08),0_24px_60px_rgba(0,0,0,0.16)]">
          <span className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] text-fog">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? 'bg-verdant' : 'bg-warn'}`} />
            {citation.factType} · {ok ? 'verified verbatim' : 'unverified'}
          </span>
          “{citation.quote}”
        </span>
      )}
    </span>
  );
}

export function CitationRow({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <span className="mt-2 flex flex-wrap gap-1.5">
      {citations.map((c, i) => (
        <CitationChip key={i} citation={c} />
      ))}
    </span>
  );
}

// ── PrivacyPanel: the audit of what left the machine ──
interface AiCall {
  id: string;
  ts: string;
  stage: string;
  model: string;
  entity_stats_json: string;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  ok: number;
}

function highlightPlaceholders(text: string) {
  const parts = text.split(/(\[[A-Z]+_\d+\])/g);
  return parts.map((p, i) =>
    /^\[[A-Z]+_\d+\]$/.test(p) ? (
      <mark key={i} className="rounded bg-ember/15 px-0.5 font-medium text-ember">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function PrivacyPanel({ onClose }: { onClose: () => void }) {
  const [calls, setCalls] = useState<AiCall[]>([]);
  const [selected, setSelected] = useState<(AiCall & { sanitized_prompt: string }) | null>(null);

  useEffect(() => {
    get<AiCall[]>('/privacy/calls').then(setCalls).catch(() => setCalls([]));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="animate-backdrop-in fixed inset-0 z-40 flex justify-end bg-black/25 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass animate-sheet-in h-full w-full max-w-2xl overflow-y-auto border-l border-black/[0.08] p-8 shadow-[-8px_0_24px_rgba(27,26,24,0.08),-32px_0_100px_rgba(27,26,24,0.22)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-2xl font-semibold tracking-tight text-bone">What left your machine</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-fog transition-all hover:rotate-90 hover:bg-black/10 hover:text-bone" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="mb-6 max-w-md text-sm leading-relaxed text-fog">
          Every frontier call, with the exact payload. Entity and beneficial-owner names are replaced on-device with{' '}
          <mark className="rounded bg-ember/15 px-0.5 text-ember">placeholders</mark> before anything is sent, and restored locally on the way back.
        </p>
        {selected ? (
          <div className="animate-fade-up">
            <button onClick={() => setSelected(null)} className="mb-4 text-xs font-medium text-ember hover:underline">
              ← All calls
            </button>
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-fog">
              <span>{selected.stage}</span>
              <span>{selected.model}</span>
              <span>{(selected.duration_ms / 1000).toFixed(1)}s</span>
              <span>
                {selected.input_tokens} in / {selected.output_tokens} out
              </span>
            </div>
            <pre className="card whitespace-pre-wrap p-5 font-mono text-xs leading-relaxed text-bone">{highlightPlaceholders(selected.sanitized_prompt)}</pre>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="text-fog">
                <tr className="border-b border-black/[0.07]">
                  <th className="px-4 py-2.5 font-medium">Stage</th>
                  <th className="px-2 py-2.5 font-medium">Masked</th>
                  <th className="px-2 py-2.5 font-medium">Tokens</th>
                  <th className="px-4 py-2.5 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="stagger">
                {calls.map((c) => {
                  const stats = JSON.parse(c.entity_stats_json || '{}') as Record<string, number>;
                  const masked = Object.values(stats).reduce((a, b) => a + b, 0);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => get<AiCall & { sanitized_prompt: string }>(`/privacy/calls/${c.id}`).then(setSelected)}
                      className="cursor-pointer border-b border-black/[0.05] transition-colors last:border-0 hover:bg-black/[0.03]"
                    >
                      <td className="px-4 py-2.5 font-mono">{c.stage}</td>
                      <td className="px-2 py-2.5 tabular-nums">{masked}</td>
                      <td className="px-2 py-2.5 font-mono tabular-nums">
                        {c.input_tokens}/{c.output_tokens}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{(c.duration_ms / 1000).toFixed(1)}s</td>
                    </tr>
                  );
                })}
                {calls.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-fog">
                      No frontier calls yet. The Brain answers without one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
