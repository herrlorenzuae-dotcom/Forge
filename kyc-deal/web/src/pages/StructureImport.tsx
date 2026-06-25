import { useRef, useState } from 'react';
import { uploadStructureExcel, uploadStructureChart, applyStructureSnapshot, type StructureDiff, type StructureSnapshot, type EntityDiff, type EdgeDiff } from '../api.js';
import { Button, GhostButton, Pill, ErrorNote } from '../components.js';

const TONE: Record<string, 'verdant' | 'ember' | 'warn' | 'neutral'> = {
  added: 'verdant',
  changed: 'ember',
  removed: 'warn',
  unchanged: 'neutral',
};

function DiffRow({ d }: { d: EntityDiff | EdgeDiff }) {
  const label = 'name' in d ? d.name : d.label;
  return (
    <div className="border-b border-black/[0.04] py-2 last:border-0">
      <div className="flex items-center gap-2">
        <Pill tone={TONE[d.status]}>{d.status}</Pill>
        <span className="text-sm text-bone">{label}</span>
      </div>
      {d.conflicts.length > 0 && (
        <div className="mt-1 pl-1">
          {d.conflicts.map((c, i) => (
            <p key={i} className="font-mono text-[11px] text-fog">
              {c.field}: <span className="text-warn line-through">{c.current || '—'}</span> → <span className="text-verdant">{c.incoming}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function StructureImport({ clientId, onApplied }: { clientId: string; onApplied: () => void }) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<StructureDiff | null>(null);
  const [snapshot, setSnapshot] = useState<StructureSnapshot | null>(null);
  const [removeMissing, setRemoveMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const ext = file.name.toLowerCase().split('.').pop() ?? '';
      const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) || file.type.startsWith('image/');
      const res = isImage ? await uploadStructureChart(clientId, file) : await uploadStructureExcel(clientId, file);
      setSnapshot(res.snapshot);
      setDiff(res.diff);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      await applyStructureSnapshot(clientId, snapshot, removeMissing);
      setDiff(null);
      setSnapshot(null);
      if (fileRef.current) fileRef.current.value = '';
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = diff ? [...diff.entities, ...diff.edges].filter((d) => d.status !== 'unchanged') : [];

  return (
    <div className="card mb-8 p-6">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-fog">Import / update structure</h2>
          <p className="mt-0.5 text-xs text-fog">
            Upload the group's structure chart — Excel template, or a PNG/JPG of the chart (export PowerPoint/Visio/Lucid to an image).
            Differences are flagged against what's on file; nothing is overwritten silently.
          </p>
        </div>
        <span className="text-fog">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-4 animate-fade-up">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif,image/*"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              className="text-xs text-fog file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-black/10 file:bg-surface file:px-4 file:py-1.5 file:text-xs file:text-bone hover:file:border-ember/40"
            />
            {busy && <span className="spinner spinner-light h-4 w-4" />}
          </div>
          <p className="mt-2 text-[11px] text-fog">
            Need the Excel template? Run <code className="font-mono text-bone">npm run template:xlsx</code> — two sheets, <em>Entities</em> and <em>Relationships</em>.
          </p>
          <p className="mt-1.5 rounded-lg border border-warn/25 bg-warn/[0.06] px-3 py-2 text-[11px] leading-relaxed text-warn">
            Privacy: a chart <strong>image</strong> is sent to the model to be read and <strong>cannot be name-masked</strong>. The Excel import stays local
            (no image leaves the machine). Use Excel when the names must not be sent.
          </p>

          <ErrorNote error={error} />

          {diff && (
            <div className="mt-4">
              <div className="mb-3 flex flex-wrap gap-2">
                <Pill tone="verdant">{diff.summary.added} added</Pill>
                <Pill tone="ember">{diff.summary.changed} changed</Pill>
                <Pill tone="warn">{diff.summary.removed} missing</Pill>
                <Pill tone="neutral">{diff.summary.unchanged} unchanged</Pill>
              </div>

              {shown.length > 0 ? (
                <div className="rounded-xl border border-black/[0.06] bg-black/[0.015] px-4 py-1">
                  {shown.map((d, i) => (
                    <DiffRow key={i} d={d} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-fog">No differences — the delivered chart matches what's on file.</p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={apply} busy={busy}>
                  Apply changes
                </Button>
                <label className="flex items-center gap-2 text-xs text-fog">
                  <input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} />
                  Also remove the {diff.summary.removed} entities/links missing from the chart
                </label>
                <GhostButton onClick={() => { setDiff(null); setSnapshot(null); }}>Discard</GhostButton>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
