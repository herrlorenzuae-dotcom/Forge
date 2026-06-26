import { describe, it, expect } from 'vitest';
import { classifyField } from './coverage.js';

describe('classifyField — gap routing', () => {
  it('routes public-register fields to the web channel', () => {
    expect(classifyField('Please provide the LEI of the entity').channel).toBe('web');
    expect(classifyField('Handelsregisternummer (HRB)').fieldType).toBe('registration_number');
    expect(classifyField('Registered office / eingetragener Sitz').channel).toBe('web');
    expect(classifyField('Date of incorporation').fieldType).toBe('incorporation_date');
  });

  it('routes client/third-party fields to the request channel', () => {
    expect(classifyField('Describe the source of funds').channel).toBe('request');
    expect(classifyField('Is any UBO a politically exposed person (PEP)?').fieldType).toBe('pep');
    expect(classifyField('Bitte beglaubigte Ausweiskopie beifügen').channel).toBe('request');
    expect(classifyField('Steueransässigkeit / TIN').fieldType).toBe('tax_residence');
  });

  it('does not match short tokens inside unrelated words (e.g. "tin" in "contracting")', () => {
    expect(classifyField('Full legal name of the contracting entity?').fieldType).not.toBe('tax_residence');
    expect(classifyField('Country of incorporation of the contracting entity').fieldType).not.toBe('tax_residence');
  });

  it('defaults unknown questions to request (never assume public)', () => {
    const c = classifyField('Some unusual bespoke question with no keywords');
    expect(c.channel).toBe('request');
    expect(c.fieldType).toBe('other');
  });
});
