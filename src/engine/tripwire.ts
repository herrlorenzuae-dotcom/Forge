/**
 * The MFN tripwire: before a side letter is signed, what does granting
 * these terms actually trigger across the fund?
 *
 * Deliberately deterministic. No model call anywhere in here: the MFN
 * basis is read from the register, the threshold and window were parsed
 * from the clause, the electors are a SQL query over commitments, and the
 * cost estimate is arithmetic. The lawyer gets facts with citations, not
 * an opinion.
 */

import type Database from 'better-sqlite3';
import { findMfnBasis, type MfnBasis } from './mfn.js';
import { classifyClauseTopic } from './side-letters.js';

export interface TripwireClause {
  term: string;
  topic: string;
  /** market convention: economic and information rights are presumptively
   *  electable; status-based carve-outs are presumptively not */
  presumptivelyElectable: boolean;
  reason: string;
  /** parsed fee reduction, when the clause is a fee discount */
  feeBps: number | null;
  /** what it costs per year if every eligible elector takes it */
  estAnnualCostUsd: number | null;
}

export interface TripwireElector {
  investorId: string;
  name: string;
  commitmentUsd: number;
  /** holds a personal MFN clause rather than (only) the fund-wide one */
  ownMfn: boolean;
}

export interface TripwireReport {
  fundId: string;
  fundName: string;
  granteeName: string;
  /** the fund-wide MFN basis, with its verbatim clause for citation */
  mfn: {
    found: boolean;
    sourceType?: string;
    sourceId?: string;
    clause?: string;
    thresholdUsd: number | null;
    thresholdUnparsed: boolean;
    windowDays: number | null;
  };
  electors: TripwireElector[];
  electorCommitmentsUsd: number;
  clauses: TripwireClause[];
  totalEstAnnualCostUsd: number | null;
  /** true when there is anything to warn about at all */
  triggered: boolean;
}

/** Topics that are, by market convention, electable economics or
 *  information rights. Status-based carve-outs (excuse, transfer) are
 *  usually tied to the recipient and presumptively excluded. */
const PRESUMPTIVELY_ELECTABLE = new Set(['fees', 'reporting', 'co_invest', 'notice', 'mfn', 'consent']);

const ELECTABLE_REASONS: Record<string, string> = {
  fees: 'Economic terms are electable under market convention.',
  reporting: 'Information rights are electable under market convention.',
  co_invest: 'Co-investment rights are electable under market convention.',
  notice: 'Notice rights are electable under market convention.',
  consent: 'Consent rights are electable under market convention.',
  mfn: 'MFN language itself propagates.',
  excuse: 'Excusal rights are usually tied to the recipient’s own legal or policy circumstances.',
  transfer: 'Transfer accommodations are usually tied to the recipient’s own structure.',
  other: 'No convention either way; the compendium classification makes the final call.',
};

/** Parse a management-fee reduction out of clause text: "twenty-five (25)
 *  basis points", "25 bps", "0.25%". Returns basis points or null. */
export function parseFeeReductionBps(text: string): number | null {
  if (!/reduc|discount|rebat|step|waiv/i.test(text)) return null;
  const bps = text.match(/(\d+(?:\.\d+)?)\s*\)?\s*(?:basis\s+points|bps)/i);
  if (bps) {
    const n = Number.parseFloat(bps[1]);
    return Number.isFinite(n) ? n : null;
  }
  const pct = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent(?:age points?)?)/i);
  if (pct) {
    const n = Number.parseFloat(pct[1]);
    return Number.isFinite(n) ? n * 100 : null;
  }
  return null;
}

/**
 * Assess what executing these clauses for this investor would trigger.
 * Pure reads and arithmetic; safe to run on every keystroke if you like.
 */
export function assessSideLetterConsequences(
  db: Database.Database,
  opts: { fundId: string; investorId: string; clauses: Array<{ term: string; text: string }> },
): TripwireReport {
  const fund = db.prepare(`SELECT id, name FROM funds WHERE id = ?`).get(opts.fundId) as
    | { id: string; name: string }
    | undefined;
  const grantee = db.prepare(`SELECT id, name FROM investors WHERE id = ?`).get(opts.investorId) as
    | { id: string; name: string }
    | undefined;
  if (!fund || !grantee) throw new Error('Unknown investor or fund');

  const basis: MfnBasis | null = findMfnBasis(db, opts.fundId);
  const thresholdUnparsed = Boolean(
    basis && basis.thresholdUsd === null && /\$|\bmillion\b|\bbillion\b/i.test(basis.sourceClause),
  );

  // who can elect: commitments at or above the threshold, never the grantee,
  // plus anyone in the fund holding a personal MFN clause
  const ownMfnIds = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT investor_id FROM obligations
           WHERE fund_id = ? AND type = 'mfn' AND investor_id IS NOT NULL AND investor_id != ?`,
        )
        .all(opts.fundId, opts.investorId) as Array<{ investor_id: string }>
    ).map((r) => r.investor_id),
  );

  let electors: TripwireElector[] = [];
  if (basis && !thresholdUnparsed) {
    const threshold = basis.thresholdUsd ?? 0;
    electors = (
      db
        .prepare(
          `SELECT i.id AS investorId, i.name, c.amount_usd AS commitmentUsd
           FROM commitments c JOIN investors i ON i.id = c.investor_id
           WHERE c.fund_id = ? AND c.amount_usd >= ? AND i.id != ?
           ORDER BY c.amount_usd DESC`,
        )
        .all(opts.fundId, threshold, opts.investorId) as Array<{ investorId: string; name: string; commitmentUsd: number }>
    ).map((e) => ({ ...e, ownMfn: ownMfnIds.has(e.investorId) }));
  }
  // personal-MFN holders elect under their own clause even if the fund-wide
  // threshold (or its parse) would have left them out
  for (const id of ownMfnIds) {
    if (electors.some((e) => e.investorId === id)) continue;
    const row = db
      .prepare(
        `SELECT i.id AS investorId, i.name, COALESCE(c.amount_usd, 0) AS commitmentUsd
         FROM investors i LEFT JOIN commitments c ON c.investor_id = i.id AND c.fund_id = ?
         WHERE i.id = ?`,
      )
      .get(opts.fundId, id) as { investorId: string; name: string; commitmentUsd: number } | undefined;
    if (row) electors.push({ ...row, ownMfn: true });
  }
  electors.sort((a, b) => b.commitmentUsd - a.commitmentUsd);
  const electorCommitmentsUsd = electors.reduce((a, e) => a + e.commitmentUsd, 0);

  const clauses: TripwireClause[] = opts.clauses.map((c) => {
    const topic = classifyClauseTopic(c.term, c.text);
    // a parseable fee reduction is economics no matter what the keyword
    // classifier thought the clause was about
    const feeBps = parseFeeReductionBps(c.text);
    const electable = PRESUMPTIVELY_ELECTABLE.has(topic) || feeBps !== null;
    const estAnnualCostUsd =
      electable && feeBps !== null && electors.length > 0
        ? Math.round((electorCommitmentsUsd * feeBps) / 10_000)
        : null;
    return {
      term: c.term,
      topic: feeBps !== null ? 'fees' : topic,
      presumptivelyElectable: electable,
      reason: feeBps !== null ? ELECTABLE_REASONS.fees : ELECTABLE_REASONS[topic] ?? ELECTABLE_REASONS.other,
      feeBps,
      estAnnualCostUsd,
    };
  });

  const costs = clauses.map((c) => c.estAnnualCostUsd).filter((n): n is number => n !== null);
  const anyElectable = clauses.some((c) => c.presumptivelyElectable);

  return {
    fundId: fund.id,
    fundName: fund.name,
    granteeName: grantee.name,
    mfn: basis
      ? {
          found: true,
          sourceType: basis.sourceType,
          sourceId: basis.sourceId,
          clause: basis.sourceClause,
          thresholdUsd: basis.thresholdUsd,
          thresholdUnparsed,
          windowDays: basis.windowDays,
        }
      : { found: false, thresholdUsd: null, thresholdUnparsed: false, windowDays: null },
    electors,
    electorCommitmentsUsd,
    clauses,
    totalEstAnnualCostUsd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
    triggered: (basis !== null || ownMfnIds.size > 0) && anyElectable && (electors.length > 0 || thresholdUnparsed),
  };
}
