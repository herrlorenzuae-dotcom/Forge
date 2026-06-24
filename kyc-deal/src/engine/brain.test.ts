import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { setDb } from '../db/db.js';
import { normalizeQuestion, recordFinalizedAnswer, getBrainOptions, listBrain, brainStats } from './brain.js';

beforeEach(() => setDb(new Database(':memory:')));

describe('normalizeQuestion', () => {
  it('collapses phrasing differences to the same key', () => {
    const a = normalizeQuestion('Please state the LEI of the contracting entity?');
    const b = normalizeQuestion('LEI of the contracting entity');
    expect(a).toBe(b);
  });
});

describe('brain convergence', () => {
  it('settles when the same answer recurs, and tracks optionality otherwise', () => {
    recordFinalizedAnswer('Country of incorporation?', 'entity', 'Luxembourg');
    recordFinalizedAnswer('country of incorporation', 'entity', 'Luxembourg');
    const opts = getBrainOptions('Country of incorporation?');
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe('Luxembourg');
    expect(opts[0].timesUsed).toBe(2);
    expect(opts[0].share).toBe(1);

    recordFinalizedAnswer('Source of funds?', 'text', 'Equity and senior financing.');
    recordFinalizedAnswer('Source of funds?', 'text', 'Shareholder equity and bank debt.');
    const opts2 = getBrainOptions('Source of funds?');
    expect(opts2).toHaveLength(2);
    expect(opts2[0].share).toBeCloseTo(0.5);
  });

  it('reports settled questions in stats', () => {
    recordFinalizedAnswer('LEI?', 'text', 'X');
    recordFinalizedAnswer('LEI?', 'text', 'X');
    const s = brainStats();
    expect(s.questions).toBe(1);
    expect(s.finalizedAnswers).toBe(2);
    expect(s.settled).toBe(1);
    expect(listBrain()[0].dominantShare).toBe(1);
  });
});
