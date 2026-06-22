/**
 * Recall eval — the number that separates "demo" from "trustworthy".
 *
 * Runs against a dedicated database, never your matters:
 *  1. Q&A retrieval over the seeded corpus (does asking find the right duties?)
 *  2. Blind re-extraction of every executed seed document, scored against
 *     the hand-labeled register
 *  3. Extraction on eval-only documents the corpus has never seen, with
 *     deliberately tricky labels (two duties in one paragraph, no-duty
 *     acknowledgments and recitals)
 *
 * Reports recall (missed duties — the malpractice direction), precision
 * (invented duties), and field accuracy on matches.
 *
 *   npm run eval            # full run (~17 frontier calls)
 *   SKIP_QA=1 npm run eval  # extraction only
 */

process.env.FORGE_DB_PATH = './data/eval.db';

import * as fs from 'node:fs';
import * as path from 'node:path';

for (const suffix of ['', '-wal', '-shm']) {
  const p = `./data/eval.db${suffix}`;
  if (fs.existsSync(p)) fs.rmSync(p);
}

const { getDb } = await import('../src/db/db.js');
const { seedDatabase } = await import('../src/seed/seed.js');
const { extractObligations, answerObligationQuery } = await import('../src/engine/obligations.js');
const { createMatter, ingestDocument } = await import('../src/engine/intake.js');
const { genId } = await import('../src/db/db.js');
const { aggregate, scoreDocument } = await import('../src/eval/score.js');
const scoreTypes = await import('../src/eval/score.js');
type DocScore = ReturnType<typeof scoreTypes.scoreDocument>;

const db = getDb();
console.log('Seeding eval database…');
const summary = await seedDatabase(db);
console.log(`  seeded — ${summary.obligations} labeled obligations, embeddings: ${summary.embeddings}\n`);

const investorNames = new Map(
  (db.prepare(`SELECT id, name FROM investors`).all() as Array<{ id: string; name: string }>).map((r) => [r.id, r.name]),
);

interface QaResult {
  question: string;
  expected: string[];
  retrieved: string[];
  recall: number;
}

// ── Part 1: Q&A retrieval (before extraction pollutes the register) ─────

const qaResults: QaResult[] = [];
if (process.env.SKIP_QA !== '1') {
  console.log('── Q&A retrieval over the seeded register ──');
  const { questions } = JSON.parse(fs.readFileSync('eval/questions.json', 'utf-8')) as {
    questions: Array<{ question: string; expectedIds: string[] }>;
  };
  let registerSize = 0;
  for (const q of questions) {
    const answer = await answerObligationQuery(q.question);
    registerSize = Math.max(registerSize, answer.totalOnFile);
    const retrieved = new Set(answer.retrievedObligationIds);
    const hit = q.expectedIds.filter((id) => retrieved.has(id));
    const recall = hit.length / q.expectedIds.length;
    qaResults.push({ question: q.question, expected: q.expectedIds, retrieved: [...retrieved], recall });
    const miss = q.expectedIds.filter((id) => !retrieved.has(id));
    console.log(`  ${recall === 1 ? '✓' : '✗'} retrieval ${hit.length}/${q.expectedIds.length}${miss.length ? ` (missed ${miss.join(', ')})` : ''} — ${q.question.slice(0, 60)}`);
  }
  if (registerSize > 0) {
    // a random 14-record pick over an N-row register hits any given id with
    // probability 14/N — disclose it so "X% retrieval" reads against the
    // right baseline instead of zero
    console.log(`  (chance baseline: a random 14-of-${registerSize} pick hits a given duty ${Math.round((Math.min(14, registerSize) / registerSize) * 100)}% of the time)`);
  }
  console.log();
}

// ── Part 2: blind re-extraction of the executed seed documents ──────────

interface SeedObligationRow {
  source_document_id: string;
  type: string;
  source_clause: string;
  notice_days: number | null;
  investor_id: string | null;
}

const seedLabels = JSON.parse(fs.readFileSync('seed/obligations.json', 'utf-8')) as SeedObligationRow[];
const byDoc = new Map<string, SeedObligationRow[]>();
for (const o of seedLabels) {
  (byDoc.get(o.source_document_id) ?? byDoc.set(o.source_document_id, []).get(o.source_document_id)!).push(o);
}

const docScores: DocScore[] = [];
console.log('── Blind re-extraction: executed seed documents ──');
for (const [docId, labels] of byDoc) {
  const { obligations } = await extractObligations(docId);
  const score = scoreDocument(
    docId,
    labels.map((l) => ({
      type: l.type,
      sourceClause: l.source_clause,
      noticeDays: l.notice_days,
      investorName: l.investor_id ? investorNames.get(l.investor_id) : null,
    })),
    obligations.map((o) => ({
      type: o.type,
      sourceClause: o.sourceClause,
      noticeDays: o.noticeDays,
      investorName: o.investorId ? investorNames.get(o.investorId) : null,
      verified: o.verified,
    })),
  );
  docScores.push(score);
  console.log(`  ${docId}: recall ${score.matched}/${score.labeled}, precision ${score.matched}/${score.extracted}`);
  for (const m of score.missedClauses) console.log(`    MISSED: "${m.slice(0, 90)}…"`);
}
console.log();

// ── Part 3: eval-only documents (never seen by the corpus) ──────────────

interface EvalDoc {
  file: string;
  matter: string;
  investors: string[];
  labels: Array<{ type: string; sourceClause: string; noticeDays?: number; investorName?: string }>;
}

const { docs: evalDocs } = JSON.parse(fs.readFileSync('eval/labels.json', 'utf-8')) as { docs: EvalDoc[] };
console.log('── Extraction on unseen eval documents ──');
for (const evalDoc of evalDocs) {
  const matter = createMatter(db, { name: evalDoc.matter });
  for (const name of evalDoc.investors) {
    const id = genId('inv');
    db.prepare(`INSERT INTO investors (id, name, type, jurisdiction) VALUES (?, ?, 'insurer', '')`).run(id, name);
    db.prepare(`INSERT INTO commitments (fund_id, investor_id, amount_usd) VALUES (?, ?, 50000000)`).run(matter.id, id);
    investorNames.set(id, name);
  }
  const buffer = fs.readFileSync(path.join('eval/docs', evalDoc.file));
  const ingested = await ingestDocument(db, {
    fundId: matter.id,
    buffer,
    filename: evalDoc.file,
    mimeType: 'text/markdown',
  });
  const { obligations } = await extractObligations(ingested.documentId);
  const score = scoreDocument(
    evalDoc.file,
    evalDoc.labels,
    obligations.map((o) => ({
      type: o.type,
      sourceClause: o.sourceClause,
      noticeDays: o.noticeDays,
      investorName: o.investorId ? investorNames.get(o.investorId) : null,
      verified: o.verified,
    })),
  );
  docScores.push(score);
  console.log(`  ${evalDoc.file}: recall ${score.matched}/${score.labeled}, precision ${score.matched}/${score.extracted}`);
  for (const m of score.missedClauses) console.log(`    MISSED: "${m.slice(0, 90)}…"`);
  for (const s of score.spuriousClauses) console.log(`    SPURIOUS: "${s.slice(0, 90)}…"`);
}

// ── Scoreboard ───────────────────────────────────────────────────────────

const agg = aggregate(docScores);
const qaRecall = qaResults.length > 0 ? qaResults.reduce((a, q) => a + q.recall, 0) / qaResults.length : null;
const pct = (n: number | null): string => (n === null ? '—' : `${(n * 100).toFixed(0)}%`);

console.log('\n════════ SCOREBOARD ════════');
console.log(`extraction recall      ${pct(agg.recall)}   (${agg.matched}/${agg.labeled} labeled duties found — the malpractice direction)`);
console.log(`extraction precision   ${pct(agg.precision)}   (${agg.matched}/${agg.extracted} extracted duties are real)`);
console.log(`type accuracy          ${pct(agg.typeAccuracy)}   (on matches)`);
console.log(`notice-days accuracy   ${pct(agg.noticeDaysAccuracy)}`);
console.log(`investor attribution   ${pct(agg.investorAccuracy)}`);
console.log(`verified verbatim      ${pct(agg.verifiedShare)}   (matched extractions whose citation check passed)`);
if (qaRecall !== null) console.log(`Q&A retrieval recall   ${pct(qaRecall)}   (${qaResults.length} questions)`);
console.log('════════════════════════════');

// EVERY metric printed is a metric gated — a scoreboard line that can
// collapse without failing the run is theater, not measurement.
const BARS: Array<{ name: string; value: number | null; bar: number }> = [
  { name: 'extraction recall', value: agg.recall, bar: 0.8 },
  { name: 'extraction precision', value: agg.precision, bar: 0.7 },
  { name: 'type accuracy', value: agg.typeAccuracy, bar: 0.8 },
  { name: 'notice-days accuracy', value: agg.noticeDaysAccuracy, bar: 0.9 },
  { name: 'investor attribution', value: agg.investorAccuracy, bar: 0.9 },
  { name: 'verified verbatim', value: agg.verifiedShare, bar: 0.9 },
  { name: 'Q&A retrieval recall', value: qaRecall, bar: 0.8 },
];
const failures = BARS.filter((b) => b.value !== null && b.value < b.bar);
const unmeasured = BARS.filter((b) => b.value === null);
if (unmeasured.length > 0) console.log(`\n(unmeasured this run: ${unmeasured.map((b) => b.name).join(', ')})`);
const verdictBad = failures.length > 0 || agg.matched === 0;
console.log(
  verdictBad
    ? `\n⚠ VERDICT: below the bar — ${agg.matched === 0 ? 'no matches at all' : failures.map((b) => `${b.name} ${pct(b.value)} < ${pct(b.bar)}`).join('; ')}. Do not trust unattended.`
    : unmeasured.length > 0
      ? `\n✓ VERDICT: every MEASURED metric meets its bar — but ${unmeasured.length} unmeasured this run (${unmeasured
          .map((b) => b.name)
          .join(', ')}), so this is a PARTIAL pass, not a clean one.`
      : '\n✓ VERDICT: every gated metric meets its bar.',
);

fs.writeFileSync(
  './data/eval-result.json',
  JSON.stringify({ ranAt: new Date().toISOString(), aggregate: agg, qa: qaResults, docs: docScores }, null, 2),
);
console.log('full results → data/eval-result.json');
process.exit(verdictBad ? 1 : 0);
