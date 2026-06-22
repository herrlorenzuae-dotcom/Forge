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
 *                        carve-out). Same status is approximated by the
 *                        investor's type.
 *   3. excluded        — not electable at all: advisory-committee seats,
 *                        priority co-investment allocation, the MFN right
 *                        itself, and structural/transfer accommodations.
 *
 * This module is the deterministic presumption used by the tripwire and to
 * compute who can elect each compendium entry. The compendium's frontier
 * classification is the authority for the final call; this is the safe,
 * inspectable default underneath it.
 */

export type Electability = 'universal' | 'status_matched' | 'excluded';

export const ELECTABILITY_LABEL: Record<Electability, string> = {
  universal: 'Universally electable',
  status_matched: 'Status-matched',
  excluded: 'Excluded',
};

const EXCLUDED_TOPICS = new Set(['advisory_board', 'co_invest', 'transfer', 'mfn']);
const STATUS_TOPICS = new Set(['excuse', 'investment_restriction']);

/** Signals that a term is tied to who the investor IS (its legal, tax or
 *  regulatory status) rather than to commitment size. */
const STATUS_SIGNAL = /regulat|statut|\btax\b|erisa|sovereign|solven|mandate|public[\s-]?policy|bank[\s-]?holding|fiduciary|sanction|treaty|immunit/i;

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
  if (STATUS_TOPICS.has(topic) || STATUS_SIGNAL.test(text)) {
    return {
      electability: 'status_matched',
      reason: 'Tied to the recipient’s legal, tax or regulatory status; electable only by investors of the same status.',
    };
  }
  return { electability: 'universal', reason: 'Information and economic rights are electable by any qualifying investor under market convention.' };
}

/** Of the investors who clear the commitment threshold, the subset who can
 *  actually elect a clause of this class. Status-matched needs the same
 *  type as the recipient; excluded, nobody. */
export function eligibleElectors<T extends { commitmentUsd: number; type?: string }>(
  thresholdElectors: T[],
  electability: Electability,
  granteeType: string | null,
): T[] {
  if (electability === 'excluded') return [];
  if (electability === 'status_matched') {
    return granteeType ? thresholdElectors.filter((e) => e.type === granteeType) : [];
  }
  return thresholdElectors;
}
