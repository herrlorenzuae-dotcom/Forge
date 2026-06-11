import { useEffect, useState } from 'react';
import { downloadDocx, get, post, usd, usdPrecise, type Citation } from '../api.js';
import { useFund } from '../fund-context.js';
import { SectionTitle, Button, CitationChip, CitationRow, ErrorNote, ThinkingCard } from '../components.js';

interface Drafts {
  drafts: Array<{
    label: string;
    rationale: string;
    clauses: Array<{ term: string; tier: string; text: string; citations: Citation[] }>;
  }>;
  termRetrieval: Array<{ term: string; suggestedTier: string }>;
  citationsVerified: { total: number; verified: number };
}

interface TripwireReport {
  fundName: string;
  granteeName: string;
  mfn: {
    found: boolean;
    sourceType?: string;
    sourceId?: string;
    clause?: string;
    thresholdUsd: number | null;
    thresholdUnparsed: boolean;
    windowDays: number | null;
  };
  electors: Array<{ investorId: string; name: string; commitmentUsd: number; ownMfn: boolean }>;
  electorCommitmentsUsd: number;
  clauses: Array<{
    term: string;
    topic: string;
    presumptivelyElectable: boolean;
    reason: string;
    feeBps: number | null;
    estAnnualCostUsd: number | null;
  }>;
  totalEstAnnualCostUsd: number | null;
  triggered: boolean;
}

interface Executed {
  documentId: string;
  sideLetterId: string;
  title: string;
  provisionCount: number;
  obligations: Array<{ id: string; type: string; summary: string; verified: boolean }>;
}

const TIER_DOT: Record<string, string> = {
  model_language: 'bg-verdant',
  adapted_precedent: 'bg-warn',
  fresh_drafting: 'bg-ember',
};

const TIER_LABEL: Record<string, string> = {
  model_language: 'Model language',
  adapted_precedent: 'Adapted precedent',
  fresh_drafting: 'Fresh drafting',
};

const DEFAULT_TERMS = `Excusal from investments in EU-sanctioned or sub-investment-grade jurisdictions, including sub-Saharan Africa
15 Business Days advance notice of any proposed investment in an excused jurisdiction
Annual ESG report on the Invest Europe template`;

export function SideLetters() {
  const { fundId } = useFund();
  const [investors, setInvestors] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [investorId, setInvestorId] = useState('inv-norrland');
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Drafts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);
  const [executed, setExecuted] = useState<Executed | null>(null);
  const [pendingSign, setPendingSign] = useState<{ draft: Drafts['drafts'][number]; report: TripwireReport } | null>(null);
  const [tripBusy, setTripBusy] = useState<string | null>(null);

  useEffect(() => {
    get<Array<{ id: string; name: string; type: string }>>('/investors')
      .then((all) => {
        setInvestors(all);
        if (all.length > 0 && !all.some((i) => i.id === 'inv-norrland')) setInvestorId(all[0].id);
      })
      .catch(() => {});
  }, []);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setExecuted(null);
    try {
      setResult(
        await post<Drafts>('/side-letters/generate', {
          fundId,
          investorId,
          agreedTerms: terms.split('\n').map((t) => t.trim()).filter(Boolean),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // step one: the tripwire. Deterministic and instant, no model call: what
  // does signing this actually trigger across the fund?
  const requestSign = async (draft: Drafts['drafts'][number]) => {
    setTripBusy(draft.label);
    setError(null);
    try {
      const report = await post<TripwireReport>('/side-letters/tripwire', {
        fundId,
        investorId,
        clauses: draft.clauses.map((c) => ({ term: c.term, text: c.text })),
      });
      setPendingSign({ draft, report });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTripBusy(null);
    }
  };

  const executeNow = async (draft: Drafts['drafts'][number]) => {
    setPendingSign(null);
    setExecuting(draft.label);
    setError(null);
    try {
      setExecuted(
        await post<Executed>('/side-letters/execute', {
          fundId,
          investorId,
          draft: {
            label: draft.label,
            clauses: draft.clauses.map((c) => ({ term: c.term, tier: c.tier, text: c.text })),
          },
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(null);
    }
  };

  return (
    <div>
      <SectionTitle
        eyebrow="Three ways to paper it"
        sub="List what you've agreed with the investor. You get three complete drafts side by side: one hewing to your model language, one adapted from executed precedent, one drafted fresh. Every clause is labelled with where its words came from. Mark the one you sign as executed and it joins the record: its clauses become precedent, its duties go on the register, and the MFN compendium sees it."
      >
        Side Letters
      </SectionTitle>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-medium text-fog">Investor</label>
            <select value={investorId} onChange={(e) => setInvestorId(e.target.value)} className="field w-full">
              {investors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={generate} busy={busy}>
            Generate three drafts
          </Button>
        </div>
        <div className="md:col-span-2">
          <label className="mb-2 block text-xs font-medium text-fog">What you've agreed. One term per line, plain English is fine</label>
          <textarea
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            rows={4}
            className="field w-full text-xs leading-relaxed"
          />
        </div>
      </div>
      <ErrorNote error={error} />

      {busy && <ThinkingCard label="Drafting three solutions" />}

      {result && (
        <div className="animate-fade-up mt-10">
          <div className="mb-4 flex flex-wrap items-center gap-5 text-xs text-fog">
            <span className="font-medium text-bone">Clause sourcing</span>
            {(['model_language', 'adapted_precedent', 'fresh_drafting'] as const).map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${TIER_DOT[t]}`} />
                {TIER_LABEL[t]}
              </span>
            ))}
            <span className="ml-auto flex items-center gap-3">
              <button
                onClick={async () => {
                  const investorName = investors.find((i) => i.id === investorId)?.name ?? 'Investor';
                  const fund = await get<{ name: string }>(`/funds/${fundId}`);
                  await downloadDocx(
                    'side-letters',
                    { fundName: fund.name, investorName, drafts: result.drafts },
                    `Side Letter Drafts - ${investorName}.docx`,
                  );
                }}
                className="btn-ghost"
              >
                ⤓ Download .docx
              </button>
              <span className="font-mono text-[10px] tabular-nums" title="Every quote was checked word-for-word against the document on file. A full count means every citation is really there.">
                {result.citationsVerified.verified}/{result.citationsVerified.total} citations verified
              </span>
            </span>
          </div>
          <div className="stagger grid gap-5 lg:grid-cols-3">
            {result.drafts.map((d) => (
              <div key={d.label} className="card card-hover flex flex-col p-6">
                <h3 className="text-lg font-semibold tracking-tight">{TIER_LABEL[d.label] ?? d.label}</h3>
                <p className="mt-1 text-xs leading-relaxed text-fog">{d.rationale}</p>
                <div className="mt-5 space-y-4">
                  {d.clauses.map((c, i) => (
                    <div key={i} className="rounded-2xl border border-black/[0.08] bg-black/[0.025] p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-fog">{c.term}</span>
                        <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[9px] text-fog">
                          <span className={`h-1.5 w-1.5 rounded-full ${TIER_DOT[c.tier] ?? 'bg-fog'}`} />
                          {TIER_LABEL[c.tier] ?? c.tier}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-bone/90">{c.text}</p>
                      <CitationRow citations={c.citations} />
                    </div>
                  ))}
                </div>
                {!executed && (
                  <div className="mt-5 border-t border-black/[0.06] pt-4">
                    <button
                      onClick={() => void requestSign(d)}
                      disabled={executing !== null || tripBusy !== null}
                      className="btn-ghost w-full text-center"
                    >
                      {executing === d.label
                        ? 'Filing the executed letter…'
                        : tripBusy === d.label
                          ? 'Checking what this triggers…'
                          : '✓ This is the one we signed. Mark as executed'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {pendingSign && (
            <div
              className="animate-backdrop-in fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-6 backdrop-blur-sm"
              onClick={() => setPendingSign(null)}
            >
              <div
                className="card-elevated animate-pop-in max-h-[85vh] w-full max-w-xl overflow-y-auto p-7"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="font-display text-2xl text-bone">Before you sign</h3>
                <p className="mt-1 text-xs text-fog">
                  {pendingSign.report.granteeName} · {pendingSign.report.fundName}. Checked against the register; no AI in
                  the math.
                </p>

                {pendingSign.report.triggered ? (
                  <>
                    {pendingSign.report.mfn.found && (
                      <div className="mt-5 rounded-2xl border border-warn/25 bg-warn/[0.05] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-xs leading-relaxed text-bone/90">
                            This fund has an MFN clause
                            {pendingSign.report.mfn.thresholdUsd != null
                              ? `: every LP at or above ${usd(pendingSign.report.mfn.thresholdUsd)} can elect the benefit of what you grant here`
                              : ''}
                            {pendingSign.report.mfn.windowDays != null
                              ? `, within ${pendingSign.report.mfn.windowDays} days of the compendium`
                              : ''}
                            .
                          </p>
                          {pendingSign.report.mfn.sourceId && (
                            <CitationChip
                              citation={{
                                sourceType: pendingSign.report.mfn.sourceType as Citation['sourceType'],
                                sourceId: pendingSign.report.mfn.sourceId,
                                quote: pendingSign.report.mfn.clause ?? '',
                              }}
                            />
                          )}
                        </div>
                        {pendingSign.report.mfn.thresholdUnparsed && (
                          <p className="mt-2 text-[11px] leading-relaxed text-warn">
                            The clause sets a monetary test the parser couldn't read, so the eligible electors are unknown.
                            Read the clause before signing.
                          </p>
                        )}
                      </div>
                    )}

                    {pendingSign.report.electors.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-semibold text-bone">
                          {pendingSign.report.electors.length} investor{pendingSign.report.electors.length === 1 ? '' : 's'}{' '}
                          can elect what you grant ({usd(pendingSign.report.electorCommitmentsUsd)} of commitments)
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {pendingSign.report.electors.map((e) => (
                            <span
                              key={e.investorId}
                              className="rounded-full border border-black/[0.09] bg-surface px-2.5 py-1 text-[11px]"
                            >
                              {e.name}{' '}
                              <span className="font-mono text-[10px] text-fog tabular-nums">{usd(e.commitmentUsd)}</span>
                              {e.ownMfn && <span className="ml-1 font-mono text-[9px] text-ember">own MFN</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-4 divide-y divide-black/[0.05] rounded-2xl border border-black/[0.07]">
                      {pendingSign.report.clauses.map((c, i) => (
                        <div key={i} className="flex items-start gap-3 px-4 py-3 text-xs">
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-bone">{c.term}</span>
                            <span className="mt-0.5 block text-[11px] leading-relaxed text-fog">{c.reason}</span>
                          </span>
                          {c.presumptivelyElectable ? (
                            <span className="shrink-0 rounded-full bg-warn/10 px-2 py-0.5 font-mono text-[10px] text-warn">
                              electable
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full bg-black/[0.05] px-2 py-0.5 font-mono text-[10px] text-fog">
                              recipient-specific
                            </span>
                          )}
                          {c.estAnnualCostUsd != null && (
                            <span className="shrink-0 font-mono text-[11px] font-semibold text-ember tabular-nums">
                              {usdPrecise(c.estAnnualCostUsd)}/yr
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {pendingSign.report.totalEstAnnualCostUsd != null && (
                      <p className="mt-4 text-sm leading-relaxed text-bone">
                        Estimated cost if every eligible elector takes the economic terms:{' '}
                        <span className="font-display text-xl text-ember">
                          {usdPrecise(pendingSign.report.totalEstAnnualCostUsd)}
                        </span>{' '}
                        <span className="text-xs text-fog">per year, on current commitments.</span>
                      </p>
                    )}
                  </>
                ) : (
                  <div className="mt-5 rounded-2xl border border-verdant/25 bg-verdant/[0.05] p-4 text-xs leading-relaxed text-bone/90">
                    No MFN consequences found:{' '}
                    {pendingSign.report.mfn.found
                      ? 'nothing in this letter is presumptively electable.'
                      : 'this fund has no MFN clause on the register.'}
                  </div>
                )}

                <div className="mt-6 flex items-center justify-end gap-2.5">
                  <button onClick={() => setPendingSign(null)} className="btn-ghost">
                    Cancel
                  </button>
                  <Button onClick={() => void executeNow(pendingSign.draft)}>Sign and file</Button>
                </div>
              </div>
            </div>
          )}

          {executing && <ThinkingCard label="Filing: clauses to precedent, duties to the register" />}

          {executed && (
            <div className="card-elevated animate-pop-in mt-8 p-7">
              <h3 className="text-sm font-semibold text-bone">
                Executed and on file: <span className="font-normal">{executed.title}</span>
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-fog">
                {executed.provisionCount} clause{executed.provisionCount === 1 ? '' : 's'} filed as precedent for future drafting. The MFN
                compendium will pick this letter up on its next run.
              </p>
              {executed.obligations.length > 0 && (
                <>
                  <p className="mt-4 text-xs font-semibold text-bone">
                    {executed.obligations.length} ongoing dut{executed.obligations.length === 1 ? 'y' : 'ies'} extracted onto the register
                  </p>
                  <div className="mt-2 divide-y divide-black/[0.05]">
                    {executed.obligations.map((o) => (
                      <div key={o.id} className="flex items-baseline gap-3 py-2 text-xs">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-ember">{o.type.replace(/_/g, ' ')}</span>
                        <span className="flex-1 leading-relaxed">{o.summary}</span>
                        <span className={`font-mono text-[10px] ${o.verified ? 'text-verdant' : 'text-warn'}`}>
                          {o.verified ? '✓ verbatim' : '✗ not found'}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
