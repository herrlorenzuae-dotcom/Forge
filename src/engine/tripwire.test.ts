/**
 * The tripwire is pure arithmetic over the register, so it gets pinned
 * hard: the seeded Fund II numbers are known, and the estimates must be
 * exactly right or the feature is worse than nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import { openDb } from '../db/db.js';
import { seedDatabase } from '../seed/seed.js';
import { assessSideLetterConsequences, parseFeeReductionBps } from './tripwire.js';

describe('fee reduction parsing', () => {
  it('reads basis points in every phrasing lawyers use', () => {
    expect(parseFeeReductionBps('the management fee shall be reduced by twenty-five (25) basis points')).toBe(25);
    expect(parseFeeReductionBps('a discount of 12.5 bps')).toBe(12.5);
    expect(parseFeeReductionBps('the fee is reduced by 0.25%')).toBe(25);
    expect(parseFeeReductionBps('fee stepped down by 0.5 percent')).toBe(50);
  });

  it('ignores numbers that are not reductions', () => {
    expect(parseFeeReductionBps('the management fee is 2% of commitments')).toBeNull();
    expect(parseFeeReductionBps('quarterly reports within 45 days')).toBeNull();
  });
});

describe('the tripwire on the seeded register', () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-trip-'));
    db = openDb(path.join(dir, 'test.db'));
    await seedDatabase(db, { embeddings: false });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a fee discount for Khalij on Fund II: 5 electors, $545M, $1.3625M/yr at 25bps', () => {
    const r = assessSideLetterConsequences(db, {
      fundId: 'fund-2',
      investorId: 'inv-khalij',
      clauses: [
        {
          term: 'Fee step-down',
          text: 'The management fee applicable to the Investor shall be reduced by twenty-five (25) basis points.',
        },
      ],
    });
    expect(r.triggered).toBe(true);
    expect(r.mfn.found).toBe(true);
    expect(r.mfn.thresholdUsd).toBe(75_000_000);
    expect(r.mfn.windowDays).toBe(30);
    // every fund-2 LP at or above $75M except the grantee
    expect(r.electors.map((e) => e.name)).toEqual([
      "Keystone State Teachers' Retirement System",
      'Ontario Metalworkers Pension Plan',
      'Norrland Pension AB',
      'Hokuriku Mutual Life Insurance Company',
      'Equatorial Development Finance Corporation',
    ]);
    expect(r.electorCommitmentsUsd).toBe(545_000_000);
    expect(r.clauses[0].feeBps).toBe(25);
    expect(r.clauses[0].estAnnualCostUsd).toBe(1_362_500);
    expect(r.totalEstAnnualCostUsd).toBe(1_362_500);
  });

  it('a real drafted clause with "per annum, payable semi-annually" still computes the cost', () => {
    const r = assessSideLetterConsequences(db, {
      fundId: 'fund-2',
      investorId: 'inv-khalij',
      clauses: [
        {
          term: 'Management Fee Reduction',
          text: 'the management fee borne by the Investor shall equal the rate otherwise applicable, reduced by twenty-five (25) basis points per annum, payable semi-annually in advance',
        },
      ],
    });
    expect(r.clauses[0].topic).toBe('fees'); // "annually" must not classify this as reporting
    expect(r.clauses[0].feeBps).toBe(25);
    expect(r.clauses[0].estAnnualCostUsd).toBe(1_362_500);
  });

  it('a bare ESG/sector excusal is UNIVERSAL — topic alone is not a status signal', () => {
    // a tobacco/ESG carve-out any LP could negotiate must NOT be narrowed to
    // the recipient's type just because the topic is "excuse"
    const r = assessSideLetterConsequences(db, {
      fundId: 'fund-2',
      investorId: 'inv-khalij',
      clauses: [
        { term: 'Excused sectors', text: 'The Investor shall be excused from participation in tobacco investments.' },
      ],
    });
    expect(r.clauses[0].electability).toBe('universal');
    expect(r.clauses[0].eligibleElectorCount).toBe(5); // every other fund-2 LP ≥ $75M
    expect(r.triggered).toBe(true);
  });

  it('a status-conditioned excusal IS status-matched; the only SWF has no same-status peer', () => {
    const r = assessSideLetterConsequences(db, {
      fundId: 'fund-2',
      investorId: 'inv-khalij', // the only SWF in Fund II
      clauses: [
        {
          term: 'Sovereign carve-out',
          text: 'The Investor shall be excused where participation is barred by the sovereign immunity or governing statute applicable to it.',
        },
      ],
    });
    expect(r.clauses[0].electability).toBe('status_matched');
    expect(r.clauses[0].eligibleElectorCount).toBe(0); // no other SWF clears the threshold
    expect(r.clauses[0].estAnnualCostUsd).toBeNull();
    expect(r.triggered).toBe(false);
  });

  it('a status-matched term WITH a same-status elector is a consequence (no cost, but flagged)', () => {
    // grant a regulatory excusal to Keystone (a pension); other pensions
    // above the threshold can elect it
    const r = assessSideLetterConsequences(db, {
      fundId: 'fund-2',
      investorId: 'inv-keystone',
      clauses: [
        {
          term: 'Regulatory excuse',
          text: 'The Investor shall be excused where participation would violate its governing statute or public-policy mandate.',
        },
      ],
    });
    expect(r.clauses[0].electability).toBe('status_matched');
    expect(r.clauses[0].eligibleElectorCount).toBeGreaterThan(0); // Ontario, Norrland are pensions ≥ $75M
    expect(r.clauses[0].eligibleCommitmentUsd).toBeLessThan(r.electorCommitmentsUsd); // a strict subset
    expect(r.clauses[0].estAnnualCostUsd).toBeNull(); // no fee, no dollar cost
    expect(r.triggered).toBe(true);
  });

  it('an advisory-committee seat is excluded: no electors, no consequence', () => {
    const r = assessSideLetterConsequences(db, {
      fundId: 'fund-2',
      investorId: 'inv-khalij',
      clauses: [{ term: 'Advisory board seat', text: 'The Investor shall be entitled to a seat on the Advisory Board.' }],
    });
    expect(r.clauses[0].electability).toBe('excluded');
    expect(r.clauses[0].eligibleElectorCount).toBe(0);
    expect(r.triggered).toBe(false);
  });

  it('Fund I: Hokuriku holds a personal MFN clause and shows up flagged', () => {
    const r = assessSideLetterConsequences(db, {
      fundId: 'fund-1',
      investorId: 'inv-keystone',
      clauses: [
        { term: 'Reporting', text: 'The General Partner shall deliver quarterly unaudited reports within 60 days.' },
      ],
    });
    const hokuriku = r.electors.find((e) => /Hokuriku/.test(e.name));
    expect(hokuriku).toBeTruthy();
    expect(hokuriku!.ownMfn).toBe(true);
    expect(r.triggered).toBe(true);
  });

  it('the grantee never elects against itself', () => {
    const r = assessSideLetterConsequences(db, {
      fundId: 'fund-2',
      investorId: 'inv-norrland',
      clauses: [{ term: 'Fee', text: 'reduced by 10 bps' }],
    });
    expect(r.electors.some((e) => /Norrland/.test(e.name))).toBe(false);
  });

  it('an unparseable monetary threshold reports unknown electors, still triggered', () => {
    db.prepare(`UPDATE obligations SET source_clause = ? WHERE id = 'obl-10'`).run(
      'Each Limited Partner whose Commitment equals or exceeds seventy-five million dollars may elect the benefit of any side letter provision within thirty (30) days.',
    );
    const r = assessSideLetterConsequences(db, {
      fundId: 'fund-2',
      investorId: 'inv-khalij',
      clauses: [{ term: 'Fee', text: 'reduced by 25 basis points' }],
    });
    expect(r.mfn.thresholdUnparsed).toBe(true);
    expect(r.electors).toEqual([]);
    expect(r.triggered).toBe(true); // unknown electors is a warning, not a pass
    expect(r.clauses[0].estAnnualCostUsd).toBeNull();
  });
});
