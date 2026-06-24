/**
 * Seed the demo: the fictional Project Halcyon client, its structure pulled
 * from the (mock) Quantium + YSolutions connectors, two historical
 * questionnaires finalized into the KYC Brain, and one fresh questionnaire
 * waiting to be answered. Run: `npm run seed`.
 */

import { getDb, genId } from '../db/db.js';
import { refreshFromConnectors } from '../engine/structure.js';
import { finalizeQuestionnaire } from '../engine/questionnaire.js';
import { HALCYON_CLIENT_REF } from '../connectors/mock-data.js';
import type { QuestionKind } from '../types.js';

const CLIENT_ID = 'client-halcyon';

// Canonical KYC questions. Banks reuse each other's language, so the same
// wording recurs across questionnaires — which is exactly what lets the
// Brain converge.
const C = {
  name: 'Full legal name of the contracting entity?',
  country: 'Country of incorporation of the contracting entity?',
  lei: 'Legal Entity Identifier (LEI) of the contracting entity?',
  regulated: 'Is the contracting entity a regulated financial institution? (Yes/No)',
  ubo: 'Please identify all ultimate beneficial owners holding 25% or more.',
  pep: 'Is any beneficial owner a politically exposed person (PEP)? (Yes/No)',
  funds: 'What is the source of funds for the transaction?',
  purpose: 'What is the purpose of the business relationship?',
} as const;

const A = {
  name: 'Halcyon BidCo S.à r.l.',
  country: 'Luxembourg',
  lei: '5299009HALCYONBIDCO12',
  regulated: 'No — it is a special-purpose acquisition vehicle, not a supervised financial institution.',
  ubo: 'Dr. Katharina Brandt — 75% (indirectly, via Brandt Familienholding GmbH and Halcyon Beteiligungs GmbH); Lars Andersson — 25%.',
  pep: 'No.',
  fundsNord: 'Equity contributions from Halcyon Holding S.à r.l. and senior acquisition financing from Nordbank AG.',
  fundsLac: 'Shareholder equity and senior bank acquisition financing.',
  purpose: 'Acquisition and holding of the Meridian Logistics Park.',
} as const;

interface QA {
  prompt: string;
  kind: QuestionKind;
  value: string;
}

function seedFinalizedQuestionnaire(requester: string, title: string, qa: QA[]): void {
  const db = getDb();
  const qnId = genId('qn');
  db.prepare(`INSERT INTO questionnaires (id, client_id, requester, title, format, raw_text, status) VALUES (?, ?, ?, ?, 'pasted', '', 'mapped')`).run(
    qnId,
    CLIENT_ID,
    requester,
    title,
  );
  const insQ = db.prepare(`INSERT INTO questions (id, questionnaire_id, position, section, prompt, kind, options_json) VALUES (?, ?, ?, '', ?, ?, '[]')`);
  const insA = db.prepare(
    `INSERT INTO answers (id, question_id, value, rationale, confidence, status, needs_review, answered_by, updated_at)
     VALUES (?, ?, ?, 'Confirmed by reviewer on a prior deal.', 1, 'accepted', 0, 'human', datetime('now'))`,
  );
  qa.forEach((item, i) => {
    const qid = genId('q');
    insQ.run(qid, qnId, i, item.prompt, item.kind);
    insA.run(genId('ans'), qid, item.value);
  });
  finalizeQuestionnaire(qnId); // folds every answer into the Brain
}

function seedPendingQuestionnaire(): void {
  const db = getDb();
  const qnId = genId('qn');
  const raw = [
    'SECTION A — THE ENTITY',
    '1. Full legal name of the contracting entity?',
    '2. Country of incorporation of the contracting entity?',
    '3. Legal Entity Identifier (LEI) of the contracting entity?',
    '4. Is the contracting entity a regulated financial institution? (Yes/No)',
    '',
    'SECTION B — OWNERSHIP',
    '5. Please identify all ultimate beneficial owners holding 25% or more.',
    '6. Is any beneficial owner a politically exposed person (PEP)? (Yes/No)',
    '',
    'SECTION C — THE TRANSACTION',
    '7. What is the source of funds for the transaction?',
    '8. What is the purpose of the business relationship?',
  ].join('\n');
  db.prepare(`INSERT INTO questionnaires (id, client_id, requester, title, format, raw_text, status) VALUES (?, ?, ?, ?, 'pasted', ?, 'parsed')`).run(
    qnId,
    CLIENT_ID,
    'Banque de Genève SA',
    'Onboarding KYC questionnaire — Project Halcyon',
    raw,
  );
  const items: { section: string; prompt: string; kind: QuestionKind }[] = [
    { section: 'SECTION A — THE ENTITY', prompt: C.name, kind: 'entity' },
    { section: 'SECTION A — THE ENTITY', prompt: C.country, kind: 'entity' },
    { section: 'SECTION A — THE ENTITY', prompt: C.lei, kind: 'text' },
    { section: 'SECTION A — THE ENTITY', prompt: C.regulated, kind: 'yesno' },
    { section: 'SECTION B — OWNERSHIP', prompt: C.ubo, kind: 'ubo_list' },
    { section: 'SECTION B — OWNERSHIP', prompt: C.pep, kind: 'yesno' },
    { section: 'SECTION C — THE TRANSACTION', prompt: C.funds, kind: 'text' },
    { section: 'SECTION C — THE TRANSACTION', prompt: C.purpose, kind: 'text' },
  ];
  const insQ = db.prepare(`INSERT INTO questions (id, questionnaire_id, position, section, prompt, kind, options_json) VALUES (?, ?, ?, ?, ?, ?, '[]')`);
  items.forEach((it, i) => insQ.run(genId('q'), qnId, i, it.section, it.prompt, it.kind));
}

async function main(): Promise<void> {
  const db = getDb();
  // Clean slate (FK-safe order).
  for (const t of ['answers', 'questions', 'questionnaires', 'answer_library', 'source_syncs', 'entity_attributes', 'ownership_edges', 'ubos', 'entities', 'ai_calls', 'clients']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }

  db.prepare(`INSERT INTO clients (id, name, deal_name, asset) VALUES (?, ?, ?, ?)`).run(
    CLIENT_ID,
    'Halcyon (Brandt family platform)',
    'Project Halcyon',
    'Meridian Logistics Park',
  );

  const counts = await refreshFromConnectors(CLIENT_ID, HALCYON_CLIENT_REF);
  console.log(`Structure imported: ${counts.entities} entities, ${counts.edges} edges, ${counts.ubos} UBOs, ${counts.attributes} attributes.`);

  seedFinalizedQuestionnaire('Nordbank AG', 'KYC questionnaire — acquisition financing', [
    { prompt: C.name, kind: 'entity', value: A.name },
    { prompt: C.country, kind: 'entity', value: A.country },
    { prompt: C.lei, kind: 'text', value: A.lei },
    { prompt: C.regulated, kind: 'yesno', value: A.regulated },
    { prompt: C.ubo, kind: 'ubo_list', value: A.ubo },
    { prompt: C.pep, kind: 'yesno', value: A.pep },
    { prompt: C.funds, kind: 'text', value: A.fundsNord },
    { prompt: C.purpose, kind: 'text', value: A.purpose },
  ]);

  seedFinalizedQuestionnaire('Crédit Lac SA', 'Client due diligence form', [
    { prompt: C.name, kind: 'entity', value: A.name },
    { prompt: C.country, kind: 'entity', value: A.country },
    { prompt: C.lei, kind: 'text', value: A.lei },
    { prompt: C.regulated, kind: 'yesno', value: A.regulated },
    { prompt: C.ubo, kind: 'ubo_list', value: A.ubo },
    { prompt: C.pep, kind: 'yesno', value: A.pep },
    { prompt: C.funds, kind: 'text', value: A.fundsLac }, // differs → optionality 2
    { prompt: C.purpose, kind: 'text', value: A.purpose },
  ]);

  seedPendingQuestionnaire();

  const brain = db.prepare(`SELECT COUNT(*) AS n FROM answer_library`).get() as { n: number };
  console.log(`KYC Brain: ${brain.n} distinct questions learned from 2 finalized questionnaires.`);
  console.log('Seed complete. Run `npm run dev` and open the app.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
