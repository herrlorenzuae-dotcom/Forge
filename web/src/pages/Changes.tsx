import { useEffect, useState } from 'react';
import { get, post, type Citation, type Fund } from '../api.js';
import { SectionTitle, Button, CitationChip, CitationRow, ErrorNote, ThinkingCard } from '../components.js';

interface Assessment {
  currentReading: string;
  marketExamples: Array<{ characterization: string; citation: Citation }>;
  alternatives: Array<{ label: string; draftText: string; tradeoffs: string; citations: Citation[] }>;
  citationsVerified: { total: number; verified: number };
}

interface DocRow {
  id: string;
  fund_id: string | null;
  type: string;
  status: string;
  title: string;
}

const SAMPLE_CHANGE = 'The managing partner wants to expand the geographic mandate to include emerging markets.';

export function Changes() {
  const [funds, setFunds] = useState<Fund[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [documentId, setDocumentId] = useState('');
  const [provisions, setProvisions] = useState<Array<{ id: string; heading: string; text: string }>>([]);
  const [provisionId, setProvisionId] = useState('');
  const [request, setRequest] = useState(SAMPLE_CHANGE);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Assessment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<Fund[]>('/funds').then(setFunds).catch(() => {});
    get<DocRow[]>('/documents')
      .then((all) => {
        const candidates = all.filter((d) => d.type !== 'term_sheet');
        setDocs(candidates);
        // prefer the seed working draft when present; otherwise any draft,
        // otherwise whatever exists — never a hardwired id on a BYO workspace
        const preferred =
          candidates.find((d) => d.id === 'doc-f3-draft') ??
          candidates.find((d) => d.status === 'draft') ??
          candidates[0];
        if (preferred) setDocumentId(preferred.id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!documentId) {
      setProvisions([]);
      setProvisionId('');
      return;
    }
    get<{ provisions: Array<{ id: string; heading: string; text: string }> }>(`/documents/${documentId}`)
      .then((d) => {
        setProvisions(d.provisions);
        const preferred = d.provisions.find((p) => p.id === 'p-f3-geo') ?? d.provisions[0];
        setProvisionId(preferred?.id ?? '');
      })
      .catch(() => {
        setProvisions([]);
        setProvisionId('');
      });
  }, [documentId]);

  const fundName = (id: string | null): string => funds.find((f) => f.id === id)?.name ?? '';
  const current = provisions.find((p) => p.id === provisionId);

  const assess = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await post<Assessment>('/changes/assess', { provisionId, changeRequest: request }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionTitle
        eyebrow="When the deal changes"
        sub="The client wants to change a term mid-raise. Pick the provision and say what's changing. The engine reads what it currently says, shows how your prior funds and side letters handled the same ground, and gives you drafting alternatives, most conservative first."
      >
        Term Changes
      </SectionTitle>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-xs font-medium text-fog">Which document?</label>
          <select value={documentId} onChange={(e) => setDocumentId(e.target.value)} className="field w-full">
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
                {fundName(d.fund_id) ? ` · ${fundName(d.fund_id)}` : ''}
              </option>
            ))}
          </select>
          <label className="mb-2 mt-4 block text-xs font-medium text-fog">Which provision?</label>
          <select value={provisionId} onChange={(e) => setProvisionId(e.target.value)} className="field w-full">
            {provisions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.heading}
              </option>
            ))}
          </select>
          {current && <p className="card mt-3 p-4 text-xs leading-relaxed text-fog">{current.text}</p>}
          {docs.length === 0 && (
            <p className="card mt-3 p-4 text-xs leading-relaxed text-fog">
              No documents on file yet. Add one under Documents first.
            </p>
          )}
        </div>
        <div>
          <label className="mb-2 block text-xs font-medium text-fog">What's changing?</label>
          <textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={4} className="field w-full" />
          <div className="mt-3">
            <Button onClick={assess} busy={busy} disabled={!provisionId || !request.trim()}>
              Assess the change
            </Button>
          </div>
        </div>
      </div>
      <ErrorNote error={error} />

      {busy && <ThinkingCard label="Assessing the change" />}

      {result && (
        <div className="animate-fade-up mt-10 space-y-8">
          <div className="card-elevated p-7">
            <h3 className="mb-2 text-sm font-semibold text-bone">What the provision currently does</h3>
            <p className="text-sm leading-relaxed text-bone/90">{result.currentReading}</p>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-bone">How your own documents have handled this</h3>
            <div className="card divide-y divide-black/[0.06] overflow-hidden">
              {result.marketExamples.map((m, i) => (
                <div key={i} className="flex items-start gap-4 px-5 py-3.5 text-sm">
                  <span className="flex-1 leading-relaxed">{m.characterization}</span>
                  <CitationChip citation={m.citation} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-bone">Menu of alternatives, most conservative first</h3>
              <span className="font-mono text-[10px] text-fog tabular-nums">
                {result.citationsVerified.verified}/{result.citationsVerified.total} citations verified
              </span>
            </div>
            <div className="stagger space-y-4">
              {result.alternatives.map((a, i) => (
                <div key={i} className="card card-hover p-6">
                  <h4 className="text-lg font-semibold tracking-tight text-ember">
                    {i + 1}. {a.label}
                  </h4>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-bone/90">{a.draftText}</p>
                  <p className="mt-3 text-xs leading-relaxed text-fog">{a.tradeoffs}</p>
                  <CitationRow citations={a.citations} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
