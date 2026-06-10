import { describe, it, expect } from 'vitest';
import { aggregate, clauseOverlap, scoreDocument } from './score.js';

describe('clause matching', () => {
  it('matches a labeled clause contained in a longer extracted clause', () => {
    const labeled = 'deliver written notice no fewer than twelve (12) Business Days prior to the closing';
    const extracted =
      'The General Partner shall deliver written notice to the investor no fewer than twelve (12) Business Days prior to the closing of any Portfolio Investment in the gaming sector';
    expect(clauseOverlap(labeled, extracted)).toBeGreaterThan(0.9);
  });

  it('does not match unrelated clauses', () => {
    expect(clauseOverlap('annual sustainability report within ninety days', 'pledge its interest without prior written consent')).toBeLessThan(0.3);
  });
});

describe('scoreDocument', () => {
  const labeled = [
    { type: 'notice', sourceClause: 'written notice no fewer than ten (10) Business Days prior to the due date', noticeDays: 10 },
    { type: 'reporting', sourceClause: 'unaudited financial statements within sixty (60) days after the end of each fiscal quarter', noticeDays: 60 },
    { type: 'transfer_restriction', sourceClause: 'No Limited Partner may pledge its interest without the prior written consent of the General Partner' },
  ];

  it('computes recall and precision with greedy one-to-one matching', () => {
    const extracted = [
      // matches labeled[0], wrong noticeDays
      { type: 'notice', sourceClause: 'Each drawdown notice shall be delivered no fewer than ten (10) Business Days prior to the due date for the related capital contribution.', noticeDays: 12 },
      // matches labeled[2], type also right
      { type: 'transfer_restriction', sourceClause: 'No Limited Partner may pledge its interest without the prior written consent of the General Partner.' },
      // spurious — invented duty
      { type: 'consent', sourceClause: 'The General Partner shall consult its cat before each investment decision.' },
    ];
    const s = scoreDocument('test-doc', labeled, extracted);
    expect(s.matched).toBe(2);
    expect(s.recall).toBeCloseTo(2 / 3);
    expect(s.precision).toBeCloseTo(2 / 3);
    expect(s.missedClauses).toHaveLength(1);
    expect(s.missedClauses[0]).toContain('sixty (60) days');
    expect(s.spuriousClauses[0]).toContain('cat');
    const m0 = s.matches.find((m) => m.labeledIndex === 0);
    expect(m0?.typeCorrect).toBe(true);
    expect(m0?.noticeDaysCorrect).toBe(false);
  });

  it('one extracted clause cannot satisfy two labels (greedy one-to-one)', () => {
    const dup = [
      { type: 'notice', sourceClause: 'written notice ten (10) Business Days prior to the due date', noticeDays: 10 },
      { type: 'notice', sourceClause: 'written notice ten (10) Business Days prior to the due date', noticeDays: 10 },
    ];
    const extracted = [{ type: 'notice', sourceClause: 'written notice ten (10) Business Days prior to the due date', noticeDays: 10 }];
    const s = scoreDocument('dup', dup, extracted);
    expect(s.matched).toBe(1);
    expect(s.recall).toBeCloseTo(0.5);
  });

  it('aggregates across documents', () => {
    const a = scoreDocument('a', labeled.slice(0, 2), [
      { type: 'notice', sourceClause: labeled[0].sourceClause, noticeDays: 10 },
    ]);
    const b = scoreDocument('b', [labeled[2]], [
      { type: 'transfer_restriction', sourceClause: labeled[2].sourceClause },
    ]);
    const agg = aggregate([a, b]);
    expect(agg.labeled).toBe(3);
    expect(agg.matched).toBe(2);
    expect(agg.recall).toBeCloseTo(2 / 3);
    expect(agg.typeAccuracy).toBe(1);
  });
});
