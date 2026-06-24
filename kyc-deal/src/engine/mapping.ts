/**
 * Mapping — the core of the tool. For each question, gather the client's
 * structure facts (each with a stable id), consult the KYC Brain for how this
 * question has been answered before, and produce an answer that cites the
 * facts it rests on. Citations are verified verbatim against the structure
 * store before the answer is stored.
 *
 * With a frontier key the model maps and drafts. Without one, the Brain
 * answers directly from the existing corpus (the dominant prior answer), so
 * a client with a history can fill a new questionnaire with no model at all.
 */

import { getDb, genId } from '../db/db.js';
import { callStructured, hasKey } from '../ai/claude.js';
import { AnswerSchema } from '../ai/schemas.js';
import { verifyCitations } from './citations.js';
import { getBrainOptions } from './brain.js';
import { getStructure } from './structure.js';
import type { Answer, BrainOption, Citation, Question } from '../types.js';

/** A compact, id-tagged dump of the structure for the model to map against. */
export function buildStructureContext(clientId: string): string {
  const { entities, edges, ubos, attributes } = getStructure(clientId);
  const nameOf = new Map(entities.map((e) => [e.id, e.name]));
  const lines: string[] = [];
  lines.push('ENTITIES');
  for (const e of entities) {
    lines.push(`- entity ${e.id} | ${e.name} | ${e.kind} | role=${e.role} | ${e.jurisdiction} | reg=${e.registration_no || '—'} | incorporated=${e.incorporation_date || '—'} | as_of=${e.as_of}`);
  }
  lines.push('\nOWNERSHIP');
  for (const e of edges) {
    lines.push(`- edge ${e.id} | ${nameOf.get(e.parent_id) ?? '?'} owns ${e.pct}% of ${nameOf.get(e.child_id) ?? '?'} (${e.kind}) | as_of=${e.as_of}`);
  }
  lines.push('\nBENEFICIAL OWNERS');
  for (const u of ubos) {
    lines.push(`- ubo ${u.id} | ${nameOf.get(u.entity_id) ?? '?'} | basis=${u.basis} | ${u.pct}% | ${u.pep ? 'PEP' : 'not PEP'} | ${u.residence} | as_of=${u.as_of}`);
  }
  lines.push('\nATTRIBUTES');
  for (const a of attributes) {
    lines.push(`- attribute ${a.id} | ${nameOf.get(a.entity_id) ?? '?'} | ${a.key} = ${a.value} | source=${a.source} | as_of=${a.as_of}`);
  }
  return lines.join('\n');
}

function loadQuestion(questionId: string): { q: Question; clientId: string } {
  const db = getDb();
  const q = db.prepare(`SELECT * FROM questions WHERE id = ?`).get(questionId) as Question | undefined;
  if (!q) throw new Error(`Question ${questionId} not found`);
  const row = db.prepare(`SELECT client_id FROM questionnaires WHERE id = ?`).get(q.questionnaire_id) as { client_id: string } | undefined;
  if (!row) throw new Error(`Questionnaire ${q.questionnaire_id} not found`);
  return { q, clientId: row.client_id };
}

function storeAnswer(args: {
  questionId: string;
  value: string;
  rationale: string;
  confidence: number;
  needsReview: boolean;
  citations: Citation[];
  options: BrainOption[];
  answeredBy: Answer['answered_by'];
}): Answer {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM answers WHERE question_id = ?`).get(args.questionId) as { id: string } | undefined;
  const id = existing?.id ?? genId('ans');
  db.prepare(
    `INSERT INTO answers (id, question_id, value, rationale, confidence, status, needs_review, citations_json, source_options_json, answered_by, updated_at)
     VALUES (@id, @question_id, @value, @rationale, @confidence, 'proposed', @needs_review, @citations_json, @source_options_json, @answered_by, datetime('now'))
     ON CONFLICT(question_id) DO UPDATE SET
       value=excluded.value, rationale=excluded.rationale, confidence=excluded.confidence,
       needs_review=excluded.needs_review, citations_json=excluded.citations_json,
       source_options_json=excluded.source_options_json, answered_by=excluded.answered_by, updated_at=datetime('now')`,
  ).run({
    id,
    question_id: args.questionId,
    value: args.value,
    rationale: args.rationale,
    confidence: args.confidence,
    needs_review: args.needsReview ? 1 : 0,
    citations_json: JSON.stringify(args.citations),
    source_options_json: JSON.stringify(args.options),
    answered_by: args.answeredBy,
  });
  return db.prepare(`SELECT * FROM answers WHERE question_id = ?`).get(args.questionId) as Answer;
}

export async function answerQuestion(questionId: string): Promise<Answer> {
  const { q, clientId } = loadQuestion(questionId);
  const options = getBrainOptions(q.prompt);

  // No key: answer straight from the Brain when it has seen this before.
  if (!hasKey()) {
    if (options.length > 0) {
      const top = options[0];
      return storeAnswer({
        questionId,
        value: top.value,
        rationale: `Answered from the KYC Brain — this question has been answered ${top.timesUsed} time(s) across prior questionnaires (${Math.round(top.share * 100)}% agreement). No model key set, so no fresh drafting.`,
        confidence: top.share,
        needsReview: top.share < 1 || options.length > 1,
        citations: [],
        options,
        answeredBy: 'brain',
      });
    }
    return storeAnswer({
      questionId,
      value: '',
      rationale: 'No prior answer in the KYC Brain and no model key set. Answer manually, or set ANTHROPIC_API_KEY to draft from the structure.',
      confidence: 0,
      needsReview: true,
      citations: [],
      options,
      answeredBy: 'brain',
    });
  }

  // With a key: map against the structure and draft, biased toward the
  // settled prior answer when the structure still supports it.
  const context = buildStructureContext(clientId);
  const priorBlock = options.length
    ? `\n\nHow this question was answered before (prefer the dominant answer if the structure still supports it):\n${options
        .map((o) => `- "${o.value}" — used ${o.timesUsed}×, ${Math.round(o.share * 100)}% of prior answers`)
        .join('\n')}`
    : '';

  const res = await callStructured({
    stage: 'mapping.answer',
    clientId,
    system:
      'You answer a single KYC questionnaire question for a client, using ONLY the structure facts provided. ' +
      'Map the question to the relevant facts and answer concisely in the form the question expects. ' +
      'Cite every fact you rely on by its id (entity/edge/ubo/attribute) and quote the exact substring you used. ' +
      'If the facts do not answer the question, say so plainly, set a low confidence and needsReview=true. Never invent facts.',
    user: `Question${q.section ? ` (section: ${q.section})` : ''}: ${q.prompt}\nExpected answer shape: ${q.kind}\n\nSTRUCTURE FACTS:\n${context}${priorBlock}`,
    schema: AnswerSchema,
    effort: 'medium',
  });

  const verified = verifyCitations(res.data.citations as Citation[], res.registry);
  const needsReview = res.data.needsReview || (verified.total > 0 && verified.verified < verified.total);
  return storeAnswer({
    questionId,
    value: res.data.value,
    rationale: res.data.rationale,
    confidence: res.data.confidence,
    needsReview,
    citations: verified.citations,
    options,
    answeredBy: 'model',
  });
}

export async function answerQuestionnaire(questionnaireId: string): Promise<{ answered: number; questions: number }> {
  const db = getDb();
  const questions = db.prepare(`SELECT id FROM questions WHERE questionnaire_id = ? ORDER BY position`).all(questionnaireId) as { id: string }[];
  let answered = 0;
  for (const { id } of questions) {
    try {
      await answerQuestion(id);
      answered++;
    } catch {
      /* leave unanswered; surfaced in the UI */
    }
  }
  db.prepare(`UPDATE questionnaires SET status = 'mapped' WHERE id = ?`).run(questionnaireId);
  return { answered, questions: questions.length };
}

/** Human edits / accepts an answer. */
export function setAnswer(questionId: string, value: string, status: 'accepted' | 'edited'): Answer {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM answers WHERE question_id = ?`).get(questionId) as { id: string } | undefined;
  if (!existing) {
    return storeAnswer({ questionId, value, rationale: 'Entered by reviewer.', confidence: 1, needsReview: false, citations: [], options: getBrainOptions(loadQuestion(questionId).q.prompt), answeredBy: 'human' });
  }
  db.prepare(`UPDATE answers SET value = ?, status = ?, needs_review = 0, answered_by = 'human', updated_at = datetime('now') WHERE question_id = ?`).run(value, status, questionId);
  return db.prepare(`SELECT * FROM answers WHERE question_id = ?`).get(questionId) as Answer;
}
