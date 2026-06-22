/**
 * The MFN exposure forecast: BEFORE the post-close election, what does
 * granting these terms expose the fund to across its investor base?
 *
 * Timing matters and the research was clear about it: MFN is not settled
 * at each side-letter signing. After the FINAL close the sponsor discloses
 * the side letters (or a summary) and runs a batched election with a
 * written window (typically 30 days). So this is a forward-looking
 * exposure forecast a sponsor's counsel uses while negotiating, not a
 * charge that lands when the pen moves.
 *
 * Deliberately deterministic. No model call anywhere in here: the MFN
 * basis is read from the register, the threshold and window were parsed
 * from the clause, the electors are a SQL query over commitments, the
 * three-class electability is a presumption, and the cost is arithmetic.
 * The lawyer gets facts with citations, not an opinion.
 */

import type Database from 'better-sqlite3';
import { findMfnBasis, type MfnBasis } from './mfn.js';
import { classifyClauseTopic } from './side-letters.js';
import { presumptiveElectability, eligibleElectors, type Electability } from './electability.js';

export interface TripwireClause {
  term: string;
  topic: string;
  /** universal / status_matched / excluded — the real three-class taxonomy */
  electability: Electability;
  reason: string;
  /** parsed fee reduction, when the clause is a fee discount */
  feeBps: number | null;
  /** how many threshold investors could actually elect THIS clause given
   *  its class (status-matched narrows to same-status investors) */
  eligibleElectorCount: number;
  eligibleCommitmentUsd: number;
  /** what it costs per year if every eligible elector takes it */
  estAnnualCostUsd: number | null;
}

export interface TripwireElector {
  investorId: string;
  name: string;
  type: string;
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
  /** every investor that clears the commitment threshold — the pool the
   *  per-clause eligible sets are drawn from */
  electors: TripwireElector[];
  electorCommitmentsUsd: number;
  clauses: TripwireClause[];
  totalEstAnnualCostUsd: number | null;
  /** true when there is an MFN consequence worth surfacing */
  triggered: boolean;
}

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
    if (!Number.isFinite(n)) return null;
    // A fractional percent is an absolute management-fee cut ("0.25%" = 25
    // bps). A bare integer percent ("reduced by 10 percent") is almost always
    // a RELATIVE reduction of the fee, not a 1000-bps absolute cut — we can't
    // convert it without the base fee, so we decline rather than overstate
    // exposure ~100x and present a wild figure as a machine-derived fact.
    return n < 1 ? n * 100 : null;
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
  const grantee = db.prepare(`SELECT id, name, type FROM investors WHERE id = ?`).get(opts.investorId) as
    | { id: string; name: string; type: string }
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
          `SELECT i.id AS investorId, i.name, i.type, c.amount_usd AS commitmentUsd
           FROM commitments c JOIN investors i ON i.id = c.investor_id
           WHERE c.fund_id = ? AND c.amount_usd >= ? AND i.id != ?
           ORDER BY c.amount_usd DESC`,
        )
        .all(opts.fundId, threshold, opts.investorId) as Array<{ investorId: string; name: string; type: string; commitmentUsd: number }>
    ).map((e) => ({ ...e, ownMfn: ownMfnIds.has(e.investorId) }));
  }
  // personal-MFN holders elect under their own clause even if the fund-wide
  // threshold (or its parse) would have left them out
  for (const id of ownMfnIds) {
    if (electors.some((e) => e.investorId === id)) continue;
    const row = db
      .prepare(
        `SELECT i.id AS investorId, i.name, i.type, COALESCE(c.amount_usd, 0) AS commitmentUsd
         FROM investors i LEFT JOIN commitments c ON c.investor_id = i.id AND c.fund_id = ?
         WHERE i.id = ?`,
      )
      .get(opts.fundId, id) as { investorId: string; name: string; type: string; commitmentUsd: number } | undefined;
    if (row) electors.push({ ...row, ownMfn: true });
  }
  electors.sort((a, b) => b.commitmentUsd - a.commitmentUsd);
  const electorCommitmentsUsd = electors.reduce((a, e) => a + e.commitmentUsd, 0);

  const clauses: TripwireClause[] = opts.clauses.map((c) => {
    const topic0 = classifyClauseTopic(c.term, c.text);
    // a parseable fee reduction is economics no matter what the keyword
    // classifier thought the clause was about
    const feeBps = parseFeeReductionBps(c.text);
    const { electability, reason } = presumptiveElectability(topic0, c.text, feeBps !== null);
    // who can elect THIS clause depends on its class: status-matched
    // narrows the threshold pool to the recipient's own status
    const eligible = eligibleElectors(electors, electability, grantee.type);
    const eligibleCommitmentUsd = eligible.reduce((a, e) => a + e.commitmentUsd, 0);
    const estAnnualCostUsd =
      feeBps !== null && eligible.length > 0 ? Math.round((eligibleCommitmentUsd * feeBps) / 10_000) : null;
    return {
      term: c.term,
      topic: feeBps !== null ? 'fees' : topic0,
      electability,
      reason,
      feeBps,
      eligibleElectorCount: eligible.length,
      eligibleCommitmentUsd,
      estAnnualCostUsd,
    };
  });

  const costs = clauses.map((c) => c.estAnnualCostUsd).filter((n): n is number => n !== null);
  // a consequence worth surfacing: a non-excluded clause that at least one
  // eligible investor could actually elect
  const anyConsequence = clauses.some((c) => c.electability !== 'excluded' && c.eligibleElectorCount > 0);

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
    // an unparsed threshold is itself a warning (electors unknown), as is a
    // real consequence among the resolved electors
    triggered: (basis !== null || ownMfnIds.size > 0) && (thresholdUnparsed || anyConsequence),
  };
}
