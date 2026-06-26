/**
 * Information requests — the "beantragen" half of audit-proof filling. Every
 * non-answered coverage item becomes a tracked request with a lifecycle, so
 * missing facts are chased, not invented:
 *   web     → propose from a public source, status starts 'open' (to verify)
 *   request → ask the client / a third party, status starts 'open'
 * Status: open → requested → received → verified  (or 'na' if not applicable).
 */

import { getDb, genId } from '../db/db.js';
import { buildCoverage } from './coverage.js';
import { getQuestionnaire } from './questionnaire.js';

export interface InfoRequest {
  id: string;
  client_id: string;
  questionnaire_id: string;
  question_id: string;
  field_type: string;
  prompt: string;
  channel: 'web' | 'request';
  source: string;
  status: 'open' | 'requested' | 'received' | 'verified' | 'na';
  note: string;
  created_at: string;
  updated_at: string;
}

export function listRequests(clientId: string): InfoRequest[] {
  return getDb()
    .prepare(`SELECT * FROM info_requests WHERE client_id = ? ORDER BY channel, field_type, created_at`)
    .all(clientId) as InfoRequest[];
}

/** Create tracked requests for every non-answered item of a questionnaire that
 *  isn't already tracked (deduped by question_id). Returns the new rows. */
export function generateRequests(questionnaireId: string): InfoRequest[] {
  const data = getQuestionnaire(questionnaireId);
  if (!data) throw new Error('questionnaire not found');
  const clientId = data.questionnaire.client_id;
  const report = buildCoverage(questionnaireId);
  const db = getDb();
  const existing = new Set(
    (db.prepare(`SELECT question_id FROM info_requests WHERE questionnaire_id = ?`).all(questionnaireId) as { question_id: string }[]).map((r) => r.question_id),
  );
  const insert = db.prepare(
    `INSERT INTO info_requests (id, client_id, questionnaire_id, question_id, field_type, prompt, channel, source, status)
     VALUES (@id, @client_id, @questionnaire_id, @question_id, @field_type, @prompt, @channel, @source, 'open')`,
  );
  const created: InfoRequest[] = [];
  const tx = db.transaction(() => {
    for (const it of report.items) {
      if (it.status === 'answered' || existing.has(it.questionId)) continue;
      const row = {
        id: genId('req'),
        client_id: clientId,
        questionnaire_id: questionnaireId,
        question_id: it.questionId,
        field_type: it.field.fieldType,
        prompt: it.prompt,
        channel: it.gapKind ?? 'request',
        source: it.source ?? '',
      };
      insert.run(row);
      created.push({ ...row, status: 'open', note: '', created_at: '', updated_at: '' });
    }
  });
  tx();
  return created;
}

export function updateRequest(id: string, patch: { status?: InfoRequest['status']; note?: string }): InfoRequest | null {
  const db = getDb();
  const cur = db.prepare(`SELECT * FROM info_requests WHERE id = ?`).get(id) as InfoRequest | undefined;
  if (!cur) return null;
  db.prepare(`UPDATE info_requests SET status = ?, note = ?, updated_at = datetime('now') WHERE id = ?`).run(
    patch.status ?? cur.status,
    patch.note ?? cur.note,
    id,
  );
  return db.prepare(`SELECT * FROM info_requests WHERE id = ?`).get(id) as InfoRequest;
}

/** Plain-text request list for the "request" channel — copy/paste into an email
 *  to the client. Web items are excluded (those we retrieve ourselves). */
export function renderRequestList(clientId: string): string {
  const rows = listRequests(clientId).filter((r) => r.channel === 'request' && r.status !== 'verified' && r.status !== 'na');
  if (!rows.length) return 'Keine offenen Anforderungen.';
  const lines = ['Benötigte Unterlagen / Angaben (KYC):', ''];
  rows.forEach((r, i) => lines.push(`${i + 1}. ${r.prompt}  —  Quelle: ${r.source}`));
  return lines.join('\n');
}
