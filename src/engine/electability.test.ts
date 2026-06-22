/**
 * The deterministic electability presumption is the safety net under the
 * frontier MFN classifier and the whole basis of the tripwire's "who can
 * elect" math. It gets pinned directly: the status signal must fire on real
 * status language and NOT on incidental vocabulary, and narrowing must never
 * silently drop below the full pool when the type proxy is meaningless.
 */

import { describe, it, expect } from 'vitest';
import { presumptiveElectability, eligibleElectors } from './electability.js';

const cls = (topic: string, text: string, fee = false) => presumptiveElectability(topic, text, fee).electability;

describe('presumptiveElectability', () => {
  it('a fee reduction is universal regardless of topic', () => {
    expect(cls('fees', 'management fee reduced by 25 basis points', true)).toBe('universal');
    expect(cls('other', 'anything at all', true)).toBe('universal');
  });

  it('excluded topics are excluded', () => {
    for (const t of ['advisory_board', 'co_invest', 'transfer', 'mfn']) {
      expect(cls(t, 'whatever the text says')).toBe('excluded');
    }
  });

  it('fires status_matched only on genuine legal/tax/regulatory status language', () => {
    expect(cls('excuse', 'excused where prohibited by its governing statute')).toBe('status_matched');
    expect(cls('other', 'applies to the Investor as a regulated insurer')).toBe('status_matched');
    expect(cls('excuse', 'excused where barred by sovereign immunity')).toBe('status_matched');
    expect(cls('other', 'consistent with its ERISA obligations')).toBe('status_matched');
    expect(cls('other', 'tied to the solvency regime applicable to it')).toBe('status_matched');
    expect(cls('other', 'as required under the Bank Holding Company Act')).toBe('status_matched');
  });

  it('does NOT fire status_matched on incidental vocabulary in universal clauses', () => {
    // these flipped the class before the signal was tightened
    expect(cls('reporting', 'quarterly regulatory reporting deadlines')).toBe('universal');
    expect(cls('distribution', 'subject to tax withholding on distributions')).toBe('universal');
    expect(cls('consent', 'the General Partner owes a fiduciary duty here')).toBe('universal');
    expect(cls('compliance', 'standard sanctions screening applies')).toBe('universal');
  });

  it('a bare ESG/sector excusal with no status basis is universal, not status_matched', () => {
    expect(cls('excuse', 'excused from participation in tobacco investments')).toBe('universal');
    expect(cls('investment_restriction', 'no investments in fossil fuels')).toBe('universal');
  });

  it('plain information rights are universal', () => {
    expect(cls('reporting', 'quarterly unaudited statements to all Limited Partners')).toBe('universal');
  });
});

describe('eligibleElectors', () => {
  // no personal MFNs — isolates the type-narrowing behavior
  const plain = [
    { investorId: 'a', commitmentUsd: 100, type: 'pension', ownMfn: false },
    { investorId: 'b', commitmentUsd: 90, type: 'pension', ownMfn: false },
    { investorId: 'c', commitmentUsd: 80, type: 'insurer', ownMfn: false },
    { investorId: 'd', commitmentUsd: 70, type: 'swf', ownMfn: false },
  ];

  it('excluded → nobody', () => {
    expect(eligibleElectors(plain, 'excluded', 'pension')).toEqual([]);
  });

  it('universal → everyone in the threshold pool', () => {
    expect(eligibleElectors(plain, 'universal', 'pension')).toHaveLength(4);
  });

  it('status_matched → same-type peers only', () => {
    const r = eligibleElectors(plain, 'status_matched', 'pension');
    expect(r.map((e) => e.investorId).sort()).toEqual(['a', 'b']);
  });

  it('status_matched keeps a personal-MFN holder of a DIFFERENT type', () => {
    // the swf holds its own MFN, so it elects under its own clause even though
    // the grantee is a pension
    const withOwnMfn = plain.map((e) => (e.investorId === 'd' ? { ...e, ownMfn: true } : e));
    const r = eligibleElectors(withOwnMfn, 'status_matched', 'pension');
    expect(r.map((e) => e.investorId).sort()).toEqual(['a', 'b', 'd']);
  });

  it('status_matched does NOT narrow when the type is unknown or a catch-all', () => {
    expect(eligibleElectors(plain, 'status_matched', null)).toHaveLength(4);
    expect(eligibleElectors(plain, 'status_matched', 'other')).toHaveLength(4);
  });
});
