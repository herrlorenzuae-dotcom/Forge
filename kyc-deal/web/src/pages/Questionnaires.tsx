import { useEffect, useState } from 'react';
import {
  get,
  post,
  parseCitations,
  parseOptions,
  type QuestionnaireListItem,
  type QuestionnaireDetail,
  type Question,
} from '../api.js';
import { useClient } from '../App.js';
import { SectionTitle, Button, GhostButton, Pill, ErrorNote, ConfidenceBar, CitationRow, Icon } from '../components.js';
import { CoveragePanel } from '../CoveragePanel.js';

function StatusPill({ status }: { status: string }) {
  const tone = status === 'finalized' ? 'verdant' : status === 'mapped' ? 'ember' : 'neutral';
  return <Pill tone={tone}>{status}</Pill>;
}

function AnswerBlock({ q, onAnswer, onSave, busy }: { q: Question; onAnswer: () => void; onSave: (v: string) => void; busy: boolean }) {
  const a = q.answer;
  const citations = parseCitations(a);
  const options = parseOptions(a);
  const [edit, setEdit] = useState<string | null>(null);

  return (
    <div className="card mt-3 p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Pill>{q.kind.replace(/_/g, ' ')}</Pill>
        {a && (
          <Pill tone={a.answered_by === 'model' ? 'ember' : a.answered_by === 'brain' ? 'verdant' : 'neutral'}>
            {a.answered_by === 'model' ? 'drafted by model' : a.answered_by === 'brain' ? 'from KYC Brain' : 'by reviewer'}
          </Pill>
        )}
        {a?.needs_review === 1 && <Pill tone="warn">needs review</Pill>}
        {a && <ConfidenceBar value={a.confidence} />}
      </div>

      {a ? (
        <>
          {edit === null ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-bone">{a.value || <span className="text-fog">— no answer —</span>}</p>
          ) : (
            <textarea value={edit} onChange={(e) => setEdit(e.target.value)} className="field min-h-20 w-full" />
          )}
          {a.rationale && edit === null && <p className="mt-2 text-xs italic leading-relaxed text-fog">{a.rationale}</p>}
          <CitationRow citations={citations} />
        </>
      ) : (
        <p className="text-sm text-fog">Not answered yet.</p>
      )}

      {options.length > 0 && (
        <div className="mt-3 border-t border-black/[0.05] pt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fog">Prior answers in the Brain</p>
          <div className="flex flex-wrap gap-1.5">
            {options.map((o, i) => (
              <button
                key={i}
                onClick={() => onSave(o.value)}
                title={`Used ${o.timesUsed}× · ${Math.round(o.share * 100)}% agreement — click to use`}
                className="rounded-md border border-black/10 bg-black/[0.02] px-2 py-1 text-left text-[11px] text-fog transition-colors hover:border-ember/50 hover:text-ember"
              >
                <span className="font-mono">{Math.round(o.share * 100)}%</span> · {o.value.slice(0, 80)}
                {o.value.length > 80 ? '…' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <GhostButton onClick={onAnswer} busy={busy}>
          {a ? 'Re-answer' : 'Answer'}
        </GhostButton>
        {a &&
          (edit === null ? (
            <GhostButton onClick={() => setEdit(a.value)}>Edit</GhostButton>
          ) : (
            <>
              <GhostButton
                onClick={() => {
                  onSave(edit);
                  setEdit(null);
                }}
              >
                Save
              </GhostButton>
              <GhostButton onClick={() => setEdit(null)}>Cancel</GhostButton>
            </>
          ))}
      </div>
    </div>
  );
}

export function Questionnaires() {
  const { clientId } = useClient();
  const [list, setList] = useState<QuestionnaireListItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QuestionnaireDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [busyQ, setBusyQ] = useState<string | null>(null);
  const [covVersion, setCovVersion] = useState(0);
  const bumpCoverage = () => setCovVersion((v) => v + 1);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ requester: '', title: '', rawText: '' });
  const [showForm, setShowForm] = useState(false);

  const loadList = () => get<QuestionnaireListItem[]>(`/clients/${clientId}/questionnaires`).then(setList).catch(() => {});
  useEffect(() => {
    if (clientId) loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const openDetail = async (id: string) => {
    setError(null);
    setOpenId(id);
    try {
      setDetail(await get<QuestionnaireDetail>(`/questionnaires/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const reloadDetail = () => (openId ? openDetail(openId) : Promise.resolve());

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await post<{ id: string }>(`/clients/${clientId}/questionnaires`, form);
      setForm({ requester: '', title: '', rawText: '' });
      setShowForm(false);
      await loadList();
      await openDetail(res.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const answerAll = async () => {
    if (!openId) return;
    setBusyAll(true);
    setError(null);
    try {
      await post(`/questionnaires/${openId}/answer`);
      await reloadDetail();
      await loadList();
      bumpCoverage();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAll(false);
    }
  };

  const answerOne = async (qid: string) => {
    setBusyQ(qid);
    setError(null);
    try {
      await post(`/questions/${qid}/answer`);
      await reloadDetail();
      bumpCoverage();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyQ(null);
    }
  };

  const saveAnswer = async (qid: string, value: string) => {
    setError(null);
    try {
      await post(`/questions/${qid}/set`, { value, status: 'edited' });
      await reloadDetail();
      bumpCoverage();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const finalize = async () => {
    if (!openId) return;
    setError(null);
    try {
      const res = await post<{ folded: number }>(`/questionnaires/${openId}/finalize`);
      await reloadDetail();
      await loadList();
      setError(null);
      alert(`Finalized — ${res.folded} answers folded into the KYC Brain.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ── Detail view ──
  if (openId && detail) {
    const sections = Array.from(new Set(detail.questions.map((q) => q.section)));
    return (
      <div>
        <button onClick={() => { setOpenId(null); setDetail(null); }} className="mb-4 text-xs font-medium text-ember hover:underline">
          ← All questionnaires
        </button>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-fog">{detail.questionnaire.requester}</p>
            <h1 className="font-display text-3xl text-bone">{detail.questionnaire.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill status={detail.questionnaire.status} />
            {/* Easter egg: codename "Ab geht die Lutzi" — the one-click auto-fill */}
            <Button onClick={answerAll} busy={busyAll} title="Ab geht die Lutzi 🚀" busyLabel="Lutzi läuft …">
              <Icon name="auto_awesome" size={16} /> Answer all
            </Button>
            <GhostButton onClick={finalize}>
              <Icon name="psychology" size={15} /> Finalize → Brain
            </GhostButton>
          </div>
        </div>
        <ErrorNote error={error} />

        <CoveragePanel questionnaireId={openId} clientId={clientId} version={covVersion} />

        {sections.map((section) => (
          <div key={section || '_'} className="mb-8">
            {section && <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.15em] text-fog">{section}</h2>}
            {detail.questions
              .filter((q) => q.section === section)
              .map((q) => (
                <div key={q.id} className="mb-4">
                  <p className="text-[15px] font-medium leading-snug text-bone">{q.prompt}</p>
                  <AnswerBlock q={q} busy={busyQ === q.id} onAnswer={() => answerOne(q.id)} onSave={(v) => saveAnswer(q.id, v)} />
                </div>
              ))}
          </div>
        ))}
      </div>
    );
  }

  // ── List view ──
  return (
    <div>
      <SectionTitle eyebrow="Map &amp; answer" sub="Paste any bank or service-provider KYC questionnaire. KYC Deal splits it into questions, maps each to the structure, and proposes an answer that cites the fact it rests on — reusing what the Brain already knows.">
        Questionnaires
      </SectionTitle>
      <ErrorNote error={error} />

      <div className="mb-6">
        {!showForm ? (
          <Button onClick={() => setShowForm(true)}>+ New questionnaire</Button>
        ) : (
          <div className="card animate-pop-in p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="field" placeholder="Requester (e.g. Banque de Genève SA)" value={form.requester} onChange={(e) => setForm({ ...form, requester: e.target.value })} />
              <input className="field" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <textarea
              className="field mt-3 min-h-44 w-full font-mono text-xs"
              placeholder="Paste the questionnaire text here. Numbered items, bullets and section headings are all understood."
              value={form.rawText}
              onChange={(e) => setForm({ ...form, rawText: e.target.value })}
            />
            <div className="mt-3 flex gap-2">
              <Button onClick={create} busy={creating} disabled={!form.rawText.trim()}>
                Parse questions
              </Button>
              <GhostButton onClick={() => setShowForm(false)}>Cancel</GhostButton>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-4 stagger sm:grid-cols-2">
        {list.map((qn) => (
          <button key={qn.id} onClick={() => openDetail(qn.id)} className="card card-hover p-5 text-left">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-fog">{qn.requester || '—'}</span>
              <StatusPill status={qn.status} />
            </div>
            <p className="font-display text-lg leading-tight text-bone">{qn.title}</p>
            <p className="mt-2 text-xs text-fog">
              {qn.answered_count}/{qn.question_count} answered
            </p>
          </button>
        ))}
        {list.length === 0 && <p className="text-sm text-fog">No questionnaires yet.</p>}
      </div>
    </div>
  );
}
