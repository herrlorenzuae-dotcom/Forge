/**
 * MFN electability — the three classes practitioners actually use.
 *
 * Per Dechert's side-letter guidance, a granted term falls into one of
 * three classes, not a binary:
 *   1. universal       — electable by any investor whose commitment meets
 *                        or exceeds the original recipient's threshold.
 *   2. status_matched  — electable only where the investor ALSO shares the
 *                        recipient's legal, tax or regulatory status (e.g.
 *                        a DFI's statutory mandate, an insurer's solvency
 *                        carve-out). Same status is APPROXIMATED by the
 *                        investor's commercial type — a presumption to
 *                        verify, not a hard fact (two same-type LPs in
 *                        different regimes need not share legal status), so
 *                        we lean toward over-inclusion: a status-matched
 *                        clause never silently drops below the full
 *                        threshold pool when the type proxy can't be trusted
 *                        (catch-all 'other'/unknown type), and never drops a
 *                        holder of its own personal MFN.
 *   3. excluded        — not electable at all: advisory-committee seats,
 *                        priority co-investment allocation, the MFN right
 *                        itself, and structural/transfer accommodations.
 *
 * This module is the deterministic presumption used by the tripwire and to
 * compute who can elect each compendium entry. The compendium's frontier
 * classification is the authority for the final call; this is the safe,
 * inspectable default underneath it. For a warning tool the safe error is
 * over-inclusion, so every judgment here errs toward NOT understating who
 * can elect.
 */

export type Electability = 'universal' | 'status_matched' | 'excluded';

export const ELECTABILITY_LABEL: Record<Electability, string> = {
  universal: 'Universally electable',
  status_matched: 'Status-matched',
  excluded: 'Excluded',
};

const EXCLUDED_TOPICS = new Set(['advisory_board', 'co_invest', 'transfer', 'mfn']);

/** Signals that a term is tied to who the investor IS (its legal, tax or
 *  regulatory status) rather than to commitment size. Deliberately narrow:
 *  only words that scarcely appear UNLESS the clause is conditioned on the
 *  investor's status. Broad words that show up in ordinary universal clauses
 *  ('regulatory reporting', 'tax withholding', 'fiduciary duty', 'sanctions
 *  screening') were removed because matching them flips a universal right to
 *  status-matched and silently shrinks the elector pool — the dangerous
 *  direction for a warning tool. Topic alone (e.g. 'excuse') is NOT a status
 *  signal: an ESG/tobacco excusal any LP may elect must stay universal; only
 *  an excuse tied to a statute/regulator/ERISA/sovereign status matches. */
const STATUS_SIGNAL = /\berisa\b|statut|sovereign|solven|bank[\s-]?holding|treaty|immunit|governing law of its|regulated (?:bank|insurer|entity)/i;

export function presumptiveElectability(
  topic: string,
  text: string,
  isFeeReduction: boolean,
): { electability: Electability; reason: string } {
  // economics are electable by any qualifying investor regardless of topic
  if (isFeeReduction) {
    return { electability: 'universal', reason: 'Economic terms are electable by any qualifying investor under market convention.' };
  }
  if (EXCLUDED_TOPICS.has(topic)) {
    return {
      electability: 'excluded',
      reason: 'Advisory-committee seats, priority co-investment, the MFN right itself and structural accommodations are conventionally excluded from election.',
    };
  }
  if (STATUS_SIGNAL.test(text)) {
    return {
      electability: 'status_matched',
      reason: 'Conditioned on the recipient’s legal, tax or regulatory status; presumptively electable only by investors of the same status (type is an approximation — verify the peers).',
    };
  }
  return { electability: 'universal', reason: 'Information and economic rights are electable by any qualifying investor under market convention.' };
}

/** Of the investors who clear the commitment threshold, the subset who can
 *  actually elect a clause of this class. Excluded → nobody. Universal →
 *  everyone. Status-matched → the recipient's same-type peers, PLUS any
 *  holder of a personal MFN (they elect under their own clause regardless of
 *  status). Because commercial type is only a proxy for legal/tax status, we
 *  do NOT narrow when the proxy is meaningless: a grant to a catch-all
 *  'other'-type recipient, or with the recipient's type unknown, keeps the
 *  full threshold pool rather than silently over- or under-matching it. The
 *  error we tolerate is over-inclusion, never silent understatement. */
export function eligibleElectors<T extends { commitmentUsd: number; type?: string; ownMfn?: boolean }>(
  thresholdElectors: T[],
  electability: Electability,
  granteeType: string | null,
): T[] {
  if (electability === 'excluded') return [];
  if (electability === 'status_matched') {
    // catch-all or unknown type: type equality means nothing — don't narrow
    if (!granteeType || granteeType === 'other') return thresholdElectors;
    return thresholdElectors.filter((e) => e.type === granteeType || e.ownMfn === true);
  }
  return thresholdElectors;
}
