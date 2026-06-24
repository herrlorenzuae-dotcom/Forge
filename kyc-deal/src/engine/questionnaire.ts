/** Read helpers and finalization for questionnaires. Finalizing folds every
 *  answered question into the KYC Brain, which is how the corpus grows. */

import { getDb } from '../db/db.js';
import { recordFinalizedAnswer } from './brain.js';
import type { Answer, Question } from '../types.js';

export interface QuestionnaireRow {
  id: string;
  client_id: string;
  requester: string;
  title: string;
  format: string;
  status: string;
  created_at: string;
}

export interface QuestionWithAnswer extends Question {
  answer: Answer | null;
}

export function listQuestionnaires(clientId: string): (QuestionnaireRow & { question_count: number; answered_count: number })[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT qn.*,
        (SELECT COUNT(*) FROM questions q WHERE q.questionnaire_id = qn.id) AS question_count,
        (SELECT COUNT(*) FROM questions q JOIN answers a ON a.question_id = q.id WHERE q.questionnaire_id = qn.id AND a.value <> '') AS answered_count
       FROM questionnaires qn WHERE qn.client_id = ? ORDER BY qn.created_at DESC`,
    )
    .all(clientId) as (QuestionnaireRow & { question_count: number; answered_count: number })[];
}

export function getQuestionnaire(id: string): { questionnaire: QuestionnaireRow; questions: QuestionWithAnswer[] } | null {
  const db = getDb();
  const questionnaire = db.prepare(`SELECT * FROM questionnaires WHERE id = ?`).get(id) as QuestionnaireRow | undefined;
  if (!questionnaire) return null;
  const questions = db.prepare(`SELECT * FROM questions WHERE questionnaire_id = ? ORDER BY position`).all(id) as Question[];
  const withAnswers: QuestionWithAnswer[] = questions.map((q) => ({
    ...q,
    answer: (db.prepare(`SELECT * FROM answers WHERE question_id = ?`).get(q.id) as Answer | undefined) ?? null,
  }));
  return { questionnaire, questions: withAnswers };
}

export function finalizeQuestionnaire(id: string): { folded: number } {
  const db = getDb();
  const detail = getQuestionnaire(id);
  if (!detail) throw new Error(`Questionnaire ${id} not found`);
  let folded = 0;
  for (const q of detail.questions) {
    if (q.answer && q.answer.value.trim()) {
      recordFinalizedAnswer(q.prompt, q.kind, q.answer.value);
      folded++;
    }
  }
  db.prepare(`UPDATE questionnaires SET status = 'finalized' WHERE id = ?`).run(id);
  return { folded };
}
