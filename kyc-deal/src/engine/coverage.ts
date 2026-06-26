/**
 * Coverage & gap analysis — the audit-proof core of filling a KYC document.
 *
 * For every requested question we decide one of three states:
 *   - answered     : a value backed by at least one VERIFIED citation (proof).
 *   - unverified   : a value exists but rests on no verified fact — not proof,
 *                    so it is treated as a gap to be sourced.
 *   - gap          : nothing on file.
 *
 * Each non-answered item is then ROUTED:
 *   - web      : publicly retrievable (LEI, register no., registered office,
 *                incorporation date …) → propose from a public source, marked
 *                "to verify"; never silently trusted.
 *   - request  : must be obtained from the client / a third party (source of
 *                funds, PEP self-declaration, certified ID …).
 *
 * Nothing unproven is written into the document — it is surfaced as a precise
 * to-do (verify a web proposal) or an information request.
 */

import { getQuestionnaire } from './questionnaire.js';
import type { Citation, Question } from '../types.js';

export type GapKind = 'web' | 'request';
export type CoverageStatus = 'answered' | 'unverified' | 'gap';

export interface FieldClass {
  fieldType: string; // canonical field key, e.g. 'lei', 'source_of_funds'
  channel: GapKind; // where a missing value would come from
  source: string; // human hint: which public source, or who to ask
}

export interface CoverageItem {
  questionId: string;
  position: number;
  section: string;
  prompt: string;
  status: CoverageStatus;
  value: string;
  field: FieldClass;
  /** routing only set when status !== 'answered' */
  gapKind?: GapKind;
  source?: string;
}

export interface CoverageReport {
  questionnaireId: string;
  total: number;
  answered: number;
  unverified: number;
  gap: number;
  webGaps: number;
  requestGaps: number;
  coverage: number; // answered / total, 0..1
  items: CoverageItem[];
}

interface Rule {
  re: RegExp;
  field: string;
  channel: GapKind;
  source: string;
}

// Order matters: first match wins. German + English keywords.
const RULES: Rule[] = [
  // ── publicly retrievable (registers / public sources) ──
  { re: /\b(lei|legal entity identifier)\b/i, field: 'lei', channel: 'web', source: 'GLEIF (gleif.org)' },
  { re: /(registration|register)\s*(no|number|nr)|handelsregister|hrb|hra|register(nummer|-nr)|commercial register/i, field: 'registration_number', channel: 'web', source: 'Handels-/Unternehmensregister' },
  { re: /(registered|business)\s*(office|address|seat)|(eingetragener\s*)?sitz|gesch[äa]ftsanschrift/i, field: 'registered_office', channel: 'web', source: 'Handels-/Unternehmensregister' },
  { re: /(date|datum).*(incorporat|gr[üu]ndung|establish)|incorporation date|gr[üu]ndungsdatum/i, field: 'incorporation_date', channel: 'web', source: 'Handels-/Unternehmensregister' },
  { re: /legal form|rechtsform|company type|gesellschaftsform/i, field: 'legal_form', channel: 'web', source: 'Handels-/Unternehmensregister' },
  { re: /(managing director|director|gesch[äa]ftsf[üu]hrer|vorstand|board member|organ)\b/i, field: 'directors', channel: 'web', source: 'Handels-/Unternehmensregister' },
  { re: /(listed|b[öo]rsennotiert|stock exchange|\b(isin|ticker)\b)/i, field: 'listing', channel: 'web', source: 'Börse / öffentliche Quelle' },
  { re: /(industry|branche|\b(nace|sic)\b|sector|gesch[äa]ftst[äa]tigkeit|nature of business)/i, field: 'industry', channel: 'web', source: 'Register / Website' },
  // ── must be requested (client / third party) ──
  { re: /source of (wealth|funds)|mittelherkunft|verm[öo]gensherkunft|herkunft der (mittel|gelder)/i, field: 'source_of_funds', channel: 'request', source: 'Mandant (Erklärung + Nachweis)' },
  { re: /\b(pep|politically exposed|politisch exponiert)\b/i, field: 'pep', channel: 'request', source: 'Mandant (Selbstauskunft)' },
  { re: /(tax\s*(residence|identification)|tax\s+id\b|steuer(ans[äa]ssigkeit|nummer|id)|\b(tin|crs|fatca)\b)/i, field: 'tax_residence', channel: 'request', source: 'Mandant (+ Ansässigkeitsbescheinigung)' },
  { re: /(passport|identity (card|document)|ausweis|reisepass|id copy|lichtbild)/i, field: 'id_document', channel: 'request', source: 'Mandant (beglaubigte Kopie)' },
  { re: /(certified|beglaubigt|notari[sz]ed|apostille)/i, field: 'certified_document', channel: 'request', source: 'Mandant (Beglaubigung)' },
  { re: /(bank reference|bankreferenz|bank statement|kontoauszug)/i, field: 'bank_reference', channel: 'request', source: 'Bank des Mandanten' },
  { re: /(authoris|authoriz|signatory|unterschrift|zeichnungsberecht|vollmacht|power of attorney)/i, field: 'signatory', channel: 'request', source: 'Mandant (Vollmacht/Unterschrift)' },
  { re: /(purpose|zweck).*(relationship|gesch[äa]ftsbeziehung|account|konto)|intended (nature|purpose)/i, field: 'purpose_of_relationship', channel: 'request', source: 'Mandant (Angabe)' },
  { re: /(expected|anticipated).*(volume|turnover|transaction)|transaktionsvolumen|erwartet(es|er)\s*(umsatz|volumen)/i, field: 'expected_volume', channel: 'request', source: 'Mandant (Angabe)' },
  { re: /(date of birth|geburtsdatum|geburtsort|place of birth|nationalit|staatsangeh[öo]rigkeit)/i, field: 'personal_details', channel: 'request', source: 'Mandant (UBO-Angaben)' },
];

/** Classify what a question asks for and where a missing answer would come from. */
export function classifyField(prompt: string): FieldClass {
  for (const r of RULES) {
    if (r.re.test(prompt)) return { fieldType: r.field, channel: r.channel, source: r.source };
  }
  // Unknown → default to "request": never assume something is public.
  return { fieldType: 'other', channel: 'request', source: 'Mandant (zu klären)' };
}

function hasVerifiedCitation(citationsJson: string): boolean {
  try {
    const cs = JSON.parse(citationsJson) as Citation[];
    return Array.isArray(cs) && cs.some((c) => c.verified !== false && (c.quote ?? '').trim() !== '');
  } catch {
    return false;
  }
}

export function buildCoverage(questionnaireId: string): CoverageReport {
  const data = getQuestionnaire(questionnaireId);
  if (!data) throw new Error('questionnaire not found');

  const items: CoverageItem[] = data.questions.map((q: Question & { answer: { value: string; citations_json: string } | null }) => {
    const field = classifyField(q.prompt);
    const value = q.answer?.value?.trim() ?? '';
    let status: CoverageStatus;
    if (value && q.answer && hasVerifiedCitation(q.answer.citations_json)) status = 'answered';
    else if (value) status = 'unverified';
    else status = 'gap';

    const item: CoverageItem = { questionId: q.id, position: q.position, section: q.section, prompt: q.prompt, status, value, field };
    if (status !== 'answered') {
      item.gapKind = field.channel;
      item.source = field.source;
    }
    return item;
  });

  const answered = items.filter((i) => i.status === 'answered').length;
  const unverified = items.filter((i) => i.status === 'unverified').length;
  const gap = items.filter((i) => i.status === 'gap').length;
  const open = items.filter((i) => i.status !== 'answered');
  return {
    questionnaireId,
    total: items.length,
    answered,
    unverified,
    gap,
    webGaps: open.filter((i) => i.gapKind === 'web').length,
    requestGaps: open.filter((i) => i.gapKind === 'request').length,
    coverage: items.length ? answered / items.length : 0,
    items,
  };
}
