/**
 * Questionnaire intake. Bank and service-provider KYC forms differ wildly in
 * layout, so we normalize any pasted text into an ordered list of atomic
 * questions. With a frontier key the model does the parsing; without one, a
 * deterministic line parser handles the common numbered / bulleted / "?"
 * shapes so the tool still works offline.
 */

import { getDb, genId } from '../db/db.js';
import { callStructured, hasKey } from '../ai/claude.js';
import { ParsedQuestionsSchema } from '../ai/schemas.js';
import type { Question, QuestionKind } from '../types.js';

export interface NewQuestionnaire {
  clientId: string;
  requester: string;
  title: string;
  rawText: string;
  format?: string;
}

function inferKind(prompt: string): QuestionKind {
  const p = prompt.toLowerCase();
  if (/\b(y\/n|yes\/no|yes or no)\b/.test(p) || /^(is|are|does|do|has|have|will)\b/.test(p)) return 'yesno';
  if (/\b(percent|percentage|%|shareholding|ownership stake)\b/.test(p)) return 'pct';
  if (/\b(date|incorporat|established|founded)\b/.test(p)) return 'date';
  if (/\b(ubo|beneficial owner|controlling person)\b/.test(p)) return 'ubo_list';
  if (/\b(name of|legal name|company|entity|registered)\b/.test(p)) return 'entity';
  return 'text';
}

/** Deterministic fallback parser: numbered items, bullets, or lines ending
 *  in "?". Heading-like lines become the running section. */
export function parseQuestionsHeuristic(raw: string): { section: string; prompt: string; kind: QuestionKind; options: string[] }[] {
  const out: { section: string; prompt: string; kind: QuestionKind; options: string[] }[] = [];
  let section = '';
  for (const line0 of raw.split(/\r?\n/)) {
    const line = line0.trim();
    if (!line) continue;
    const isQuestion = /\?\s*$/.test(line) || /^\s*(\d+[.)]|[-*•]|[a-z][.)])\s+/i.test(line);
    const looksHeading = !isQuestion && (/:$/.test(line) || (line === line.toUpperCase() && line.length > 3 && /[A-Z]/.test(line)) || /^(section|part|teil|abschnitt)\b/i.test(line));
    if (looksHeading) {
      section = line.replace(/:$/, '').trim();
      continue;
    }
    if (!isQuestion && line.length < 12) continue; // stray noise
    const prompt = line.replace(/^\s*(\d+[.)]|[-*•]|[a-z][.)])\s+/i, '').trim();
    if (!prompt) continue;
    out.push({ section, prompt, kind: inferKind(prompt), options: [] });
  }
  return out;
}

export async function createQuestionnaire(input: NewQuestionnaire): Promise<{ id: string; questions: Question[]; parsedBy: 'model' | 'heuristic' }> {
  const db = getDb();
  const id = genId('qn');
  db.prepare(
    `INSERT INTO questionnaires (id, client_id, requester, title, format, raw_text, status) VALUES (?, ?, ?, ?, ?, ?, 'parsed')`,
  ).run(id, input.clientId, input.requester, input.title, input.format ?? 'pasted', input.rawText);

  let parsed: { section: string; prompt: string; kind: QuestionKind; options: string[] }[];
  let parsedBy: 'model' | 'heuristic' = 'heuristic';

  if (hasKey() && input.rawText.trim()) {
    try {
      const res = await callStructured({
        stage: 'intake.parse',
        clientId: input.clientId,
        system:
          'You normalize KYC questionnaires from banks and service providers into a clean, ordered list of atomic questions. ' +
          'Split compound asks into separate questions. Keep the wording faithful. Classify the expected answer shape.',
        user: `Questionnaire from "${input.requester}", titled "${input.title}":\n\n${input.rawText}`,
        schema: ParsedQuestionsSchema,
        effort: 'medium',
      });
      parsed = res.data.questions.map((q) => ({ section: q.section, prompt: q.prompt, kind: q.kind as QuestionKind, options: q.options }));
      parsedBy = 'model';
    } catch {
      parsed = parseQuestionsHeuristic(input.rawText);
    }
  } else {
    parsed = parseQuestionsHeuristic(input.rawText);
  }

  const ins = db.prepare(
    `INSERT INTO questions (id, questionnaire_id, position, section, prompt, kind, options_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const questions: Question[] = [];
  parsed.forEach((q, i) => {
    const qid = genId('q');
    ins.run(qid, id, i, q.section, q.prompt, q.kind, JSON.stringify(q.options));
    questions.push({ id: qid, questionnaire_id: id, position: i, section: q.section, prompt: q.prompt, kind: q.kind, options_json: JSON.stringify(q.options) });
  });

  return { id, questions, parsedBy };
}
