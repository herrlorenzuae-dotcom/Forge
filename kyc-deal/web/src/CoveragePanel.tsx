import { useEffect, useState } from 'react';
import { getCoverage, getRequests, generateRequests, updateRequest, type CoverageReport, type CoverageItem, type InfoRequest } from './api.js';
import { Button, GhostButton, Icon } from './components.js';

const STATUS_LABEL: Record<string, string> = {
  open: 'offen', requested: 'angefragt', received: 'erhalten', verified: 'verifiziert', na: 'n/a',
};
const STATUSES = ['open', 'requested', 'received', 'verified', 'na'];

function Bar({ r }: { r: CoverageReport }) {
  const pct = (n: number) => (r.total ? (n / r.total) * 100 : 0);
  return (
    <div>
      <div className="flex items-end justify-between">
        <span className="font-display text-2xl text-bone">{Math.round(r.coverage * 100)}%</span>
        <span className="text-[11px] text-fog">
          {r.answered}/{r.total} belegt · {r.unverified} unverifiziert · {r.gap} offen
        </span>
      </div>
      <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-black/[0.06]">
        <div style={{ width: `${pct(r.answered)}%`, background: '#1f5f3c' }} title="belegt (zitiert)" />
        <div style={{ width: `${pct(r.unverified)}%`, background: '#8f6a08' }} title="unverifiziert" />
        <div style={{ width: `${pct(r.gap)}%`, background: '#b04a4a' }} title="offen" />
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-fog">
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: '#1f5f3c' }} /> belegt &amp; zitiert</span>
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: '#8f6a08' }} /> Wert ohne Beleg</span>
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: '#b04a4a' }} /> fehlt</span>
        <span className="ml-auto">🌐 öffentlich: {r.webGaps} · ✉ anzufordern: {r.requestGaps}</span>
      </div>
    </div>
  );
}

export function CoveragePanel({ questionnaireId, clientId, version }: { questionnaireId: string; clientId: string; version: number }) {
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [requests, setRequests] = useState<InfoRequest[]>([]);
  const [reqText, setReqText] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);

  const load = () => {
    getCoverage(questionnaireId).then(setReport).catch(() => setReport(null));
    getRequests(clientId).then((r) => { setRequests(r.requests); setReqText(r.text); }).catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [questionnaireId, clientId, version]);

  if (!report) return null;
  const reqByQ = new Map(requests.map((r) => [r.question_id, r]));
  const openItems = report.items.filter((i) => i.status !== 'answered');

  const generate = async () => {
    setBusy(true);
    try { await generateRequests(questionnaireId); load(); } finally { setBusy(false); }
  };
  const setStatus = async (id: string, status: string) => { await updateRequest(id, { status }); load(); };
  const copyList = () => navigator.clipboard?.writeText(reqText);

  const channelChip = (it: CoverageItem) =>
    it.gapKind === 'web' ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#1c86c8]/10 px-2 py-0.5 text-[10px] text-[#13608f]"><Icon name="language" size={13} /> öffentlich · {it.source}</span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-ember/10 px-2 py-0.5 text-[10px] text-ember"><Icon name="mail" size={13} /> anfordern · {it.source}</span>
    );

  return (
    <div className="card-elevated mb-8 p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-fog">Coverage &amp; Lücken</h2>
        <button className="text-[11px] text-fog hover:text-bone" onClick={() => setOpen((o) => !o)}>{open ? 'einklappen' : 'ausklappen'}</button>
      </div>
      <Bar r={report} />

      {open && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={generate} busy={busy}><Icon name="add_task" size={16} /> Anforderungen erzeugen</Button>
            <GhostButton onClick={copyList}><Icon name="content_copy" size={14} /> Anforderungsliste kopieren</GhostButton>
          </div>

          {openItems.length === 0 ? (
            <p className="mt-4 text-sm text-verdant">Alles belegt &amp; zitiert — keine offenen Punkte. 🎉</p>
          ) : (
            <div className="mt-4 divide-y divide-black/[0.05]">
              {openItems.map((it) => {
                const req = reqByQ.get(it.questionId);
                return (
                  <div key={it.questionId} className="flex flex-wrap items-center gap-2 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${it.status === 'unverified' ? 'bg-warn/15 text-warn' : 'bg-[#b04a4a]/12 text-[#8a3a3a]'}`}>
                      {it.status === 'unverified' ? 'ohne Beleg' : 'fehlt'}
                    </span>
                    <span className="text-sm text-bone">{it.prompt}</span>
                    {channelChip(it)}
                    <div className="ml-auto">
                      {req ? (
                        <select
                          value={req.status}
                          onChange={(e) => setStatus(req.id, e.target.value)}
                          className="rounded border border-black/15 bg-surface px-2 py-0.5 text-[11px] text-bone"
                        >
                          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </select>
                      ) : (
                        <span className="text-[10px] text-fog">noch nicht angelegt</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
