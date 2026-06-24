import { useEffect, useState } from 'react';
import { get, type Brain as BrainData } from '../api.js';
import { SectionTitle, Pill } from '../components.js';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fog">{label}</p>
      <p className="mt-1 font-display text-3xl text-bone">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-fog">{sub}</p>}
    </div>
  );
}

export function Brain() {
  const [brain, setBrain] = useState<BrainData | null>(null);
  useEffect(() => {
    get<BrainData>('/brain').then(setBrain).catch(() => {});
  }, []);

  return (
    <div>
      <SectionTitle eyebrow="Compounding knowledge" sub="Every finalized questionnaire folds its answers in here, keyed by the question. As the corpus grows, recurring questions settle on one answer — optionality falls, and the next questionnaire answers itself.">
        The KYC Brain
      </SectionTitle>

      {brain && (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-4">
            <Stat label="Questions learned" value={String(brain.stats.questions)} />
            <Stat label="Answers folded" value={String(brain.stats.finalizedAnswers)} sub="across all finalized forms" />
            <Stat label="Settled" value={String(brain.stats.settled)} sub="one answer, seen more than once" />
            <Stat label="Avg. optionality" value={brain.stats.avgOptionality.toFixed(2)} sub="distinct answers per question" />
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="text-fog">
                <tr className="border-b border-black/[0.07] text-[11px] uppercase tracking-wide">
                  <th className="px-5 py-3 font-medium">Question</th>
                  <th className="px-3 py-3 font-medium">Used</th>
                  <th className="px-3 py-3 font-medium">Options</th>
                  <th className="px-5 py-3 font-medium">Convergence</th>
                </tr>
              </thead>
              <tbody className="stagger">
                {brain.entries.map((e) => (
                  <tr key={e.id} className="border-b border-black/[0.04] align-top last:border-0">
                    <td className="px-5 py-3">
                      <p className="font-medium text-bone">{e.prompt}</p>
                      <p className="mt-1 text-xs text-fog">
                        {e.options.map((o, i) => (
                          <span key={i} className="mr-2 inline-block">
                            <span className="font-mono">{Math.round(o.share * 100)}%</span> {o.value.slice(0, 60)}
                            {o.value.length > 60 ? '…' : ''}
                          </span>
                        ))}
                      </p>
                    </td>
                    <td className="px-3 py-3 font-mono tabular-nums text-fog">{e.timesUsed}</td>
                    <td className="px-3 py-3">
                      <Pill tone={e.optionality === 1 ? 'verdant' : 'warn'}>{e.optionality}</Pill>
                    </td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-black/[0.07]">
                          <span className={`block h-full ${e.dominantShare === 1 ? 'bg-verdant' : 'bg-ember'}`} style={{ width: `${Math.round(e.dominantShare * 100)}%` }} />
                        </span>
                        <span className="font-mono text-[10px] tabular-nums text-fog">{Math.round(e.dominantShare * 100)}%</span>
                      </span>
                    </td>
                  </tr>
                ))}
                {brain.entries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-fog">
                      The Brain is empty. Finalize a questionnaire to teach it.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
