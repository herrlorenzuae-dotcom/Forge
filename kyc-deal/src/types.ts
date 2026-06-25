/** Shared domain shapes, used by the engine, the API and (mirrored) the web. */

export type EntityKind =
  | 'individual'
  | 'operating'
  | 'holding'
  | 'spv'
  | 'fund'
  | 'trust'
  | 'partnership'
  | 'foundation';

export type EntityRole = 'acquisition_vehicle' | 'topco' | 'intermediate' | 'ubo' | 'target' | 'other';

export type SourceSystem = 'quantium' | 'ysolutions' | 'manual';

export interface Entity {
  id: string;
  client_id: string;
  name: string;
  kind: EntityKind;
  role: EntityRole;
  jurisdiction: string;
  registration_no: string;
  incorporation_date: string;
  status: string;
  source: SourceSystem;
  source_ref: string;
  as_of: string;
  notes: string;
}

export type EdgeKind = 'shares' | 'partnership_interest' | 'beneficial' | 'control';

export interface OwnershipEdge {
  id: string;
  client_id: string;
  parent_id: string;
  child_id: string;
  pct: number;
  kind: EdgeKind;
  mechanism: string;
  source: SourceSystem;
  source_ref: string;
  as_of: string;
}

export type UboBasis = 'ownership' | 'control' | 'senior_managing_official';

export interface Ubo {
  id: string;
  client_id: string;
  entity_id: string;
  basis: UboBasis;
  pct: number;
  pep: number; // 0/1
  residence: string;
  source: SourceSystem;
  source_ref: string;
  as_of: string;
}

/** A citable fact about an entity — the verbatim source of an answer. */
export interface EntityAttribute {
  id: string;
  client_id: string;
  entity_id: string;
  key: string;
  value: string;
  source: SourceSystem;
  source_ref: string;
  as_of: string;
}

export type QuestionKind = 'text' | 'yesno' | 'entity' | 'ubo_list' | 'pct' | 'date' | 'choice' | 'number';

export interface Question {
  id: string;
  questionnaire_id: string;
  position: number;
  section: string;
  prompt: string;
  kind: QuestionKind;
  options_json: string;
}

export interface Citation {
  factType: 'attribute' | 'entity' | 'edge' | 'ubo';
  factId: string;
  quote: string;
  verified?: boolean;
}

export interface BrainOption {
  value: string;
  timesUsed: number;
  share: number; // fraction of finalized answers to this question carrying this value
}

export interface Answer {
  id: string;
  question_id: string;
  value: string;
  rationale: string;
  confidence: number;
  status: 'proposed' | 'accepted' | 'edited';
  needs_review: number;
  citations_json: string;
  source_options_json: string;
  answered_by: 'model' | 'brain' | 'human';
  updated_at: string;
}
