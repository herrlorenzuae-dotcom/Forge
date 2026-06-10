/**
 * Eval scoring — does extraction MISS obligations?
 *
 * Every citation the engine outputs is already verified verbatim; what
 * that can't tell you is what the engine silently skipped. In legal work
 * the dangerous failure is the missing duty, not the wrong one — so this
 * harness measures recall against hand-labeled ground truth, alongside
 * precision (invented duties) and field accuracy on the matches.
 *
 * Matching: a labeled obligation matches an extracted one when the
 * labeled source clause's tokens are (mostly) contained in the extracted
 * clause — the clause is the verifiable anchor. Greedy one-to-one
 * assignment, best overlap first.
 */

export interface LabeledObligation {
  type: string;
  sourceClause: string;
  noticeDays?: number | null;
  investorName?: string | null;
}

export interface ExtractedObligationLike {
  type: string;
  sourceClause: string;
  noticeDays?: number | null;
  investorName?: string | null;
}

export interface MatchResult {
  labeledIndex: number;
  extractedIndex: number;
  overlap: number;
  typeCorrect: boolean;
  noticeDaysCorrect: boolean;
  investorCorrect: boolean;
}

export interface DocScore {
  doc: string;
  labeled: number;
  extracted: number;
  matched: number;
  recall: number;
  precision: number;
  matches: MatchResult[];
  missedClauses: string[];
  spuriousClauses: string[];
}

const MATCH_THRESHOLD = 0.55;

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3),
  );
}

/** Containment of the labeled clause's tokens in the extracted clause. */
export function clauseOverlap(labeled: string, extracted: string): number {
  const l = tokens(labeled);
  const e = tokens(extracted);
  if (l.size === 0) return 0;
  let hit = 0;
  for (const t of l) if (e.has(t)) hit += 1;
  return hit / l.size;
}

function fieldEq(a: number | null | undefined, b: number | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

function nameEq(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = (a ?? '').toLowerCase().trim();
  const nb = (b ?? '').toLowerCase().trim();
  if (!na && !nb) return true;
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

export function scoreDocument(
  doc: string,
  labeled: LabeledObligation[],
  extracted: ExtractedObligationLike[],
): DocScore {
  // all candidate pairs above threshold, best first
  const pairs: Array<{ li: number; ei: number; overlap: number }> = [];
  labeled.forEach((l, li) => {
    extracted.forEach((e, ei) => {
      const overlap = clauseOverlap(l.sourceClause, e.sourceClause);
      if (overlap >= MATCH_THRESHOLD) pairs.push({ li, ei, overlap });
    });
  });
  pairs.sort((a, b) => b.overlap - a.overlap);

  const usedL = new Set<number>();
  const usedE = new Set<number>();
  const matches: MatchResult[] = [];
  for (const p of pairs) {
    if (usedL.has(p.li) || usedE.has(p.ei)) continue;
    usedL.add(p.li);
    usedE.add(p.ei);
    const l = labeled[p.li];
    const e = extracted[p.ei];
    matches.push({
      labeledIndex: p.li,
      extractedIndex: p.ei,
      overlap: p.overlap,
      typeCorrect: l.type === e.type,
      noticeDaysCorrect: fieldEq(l.noticeDays, e.noticeDays),
      investorCorrect: nameEq(l.investorName, e.investorName),
    });
  }

  const missedClauses = labeled.filter((_, i) => !usedL.has(i)).map((l) => l.sourceClause);
  const spuriousClauses = extracted.filter((_, i) => !usedE.has(i)).map((e) => e.sourceClause);

  return {
    doc,
    labeled: labeled.length,
    extracted: extracted.length,
    matched: matches.length,
    recall: labeled.length === 0 ? 1 : matches.length / labeled.length,
    precision: extracted.length === 0 ? 1 : matches.length / extracted.length,
    matches,
    missedClauses,
    spuriousClauses,
  };
}

export interface Aggregate {
  docs: number;
  labeled: number;
  extracted: number;
  matched: number;
  recall: number;
  precision: number;
  typeAccuracy: number;
  noticeDaysAccuracy: number;
  investorAccuracy: number;
}

export function aggregate(scores: DocScore[]): Aggregate {
  const labeled = scores.reduce((a, s) => a + s.labeled, 0);
  const extracted = scores.reduce((a, s) => a + s.extracted, 0);
  const matched = scores.reduce((a, s) => a + s.matched, 0);
  const allMatches = scores.flatMap((s) => s.matches);
  const frac = (pred: (m: MatchResult) => boolean): number =>
    allMatches.length === 0 ? 1 : allMatches.filter(pred).length / allMatches.length;
  return {
    docs: scores.length,
    labeled,
    extracted,
    matched,
    recall: labeled === 0 ? 1 : matched / labeled,
    precision: extracted === 0 ? 1 : matched / extracted,
    typeAccuracy: frac((m) => m.typeCorrect),
    noticeDaysAccuracy: frac((m) => m.noticeDaysCorrect),
    investorAccuracy: frac((m) => m.investorCorrect),
  };
}
