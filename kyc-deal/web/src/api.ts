const BASE = '/api';

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ── Shapes (mirror src/types.ts) ──

export interface Health {
  ok: boolean;
  model: string;
  anthropicKey: boolean;
  connector: string;
  staleDays: number;
}

export interface Client {
  id: string;
  name: string;
  deal_name: string;
  asset: string;
  created_at: string;
}

export interface Entity {
  id: string;
  name: string;
  kind: string;
  role: string;
  jurisdiction: string;
  registration_no: string;
  incorporation_date: string;
  status: string;
  source: string;
  source_ref: string;
  as_of: string;
  notes: string;
}

export interface OwnershipEdge {
  id: string;
  parent_id: string;
  child_id: string;
  pct: number;
  kind: string;
  source: string;
  as_of: string;
}

export interface Ubo {
  id: string;
  entity_id: string;
  basis: string;
  pct: number;
  pep: number;
  residence: string;
  source: string;
  as_of: string;
}

export interface EntityAttribute {
  id: string;
  entity_id: string;
  key: string;
  value: string;
  source: string;
  as_of: string;
}

export interface Structure {
  entities: Entity[];
  edges: OwnershipEdge[];
  ubos: Ubo[];
  attributes: EntityAttribute[];
}

export interface OrgChart {
  mermaid: string;
  nodes: { id: string; name: string; kind: string; role: string; jurisdiction: string }[];
  edges: { parent: string; child: string; pct: number; kind: string }[];
}

export interface CurrencyItem {
  ref: string;
  name: string;
  as_of: string;
  ageDays: number;
  stale: boolean;
}
export interface CurrencyReport {
  checkedAt: string;
  staleDays: number;
  items: CurrencyItem[];
  staleCount: number;
}

export interface SyncRow {
  id: string;
  connector: string;
  op: string;
  ok: number;
  items: number;
  stale_items: number;
  as_of: string;
  message: string;
  checked_at: string;
}

export interface QuestionnaireListItem {
  id: string;
  requester: string;
  title: string;
  status: string;
  created_at: string;
  question_count: number;
  answered_count: number;
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
  share: number;
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

export interface Question {
  id: string;
  questionnaire_id: string;
  position: number;
  section: string;
  prompt: string;
  kind: string;
  options_json: string;
  answer: Answer | null;
}

export interface QuestionnaireDetail {
  questionnaire: { id: string; requester: string; title: string; status: string; raw_text?: string };
  questions: Question[];
}

export interface BrainEntry {
  id: string;
  prompt: string;
  kind: string;
  timesUsed: number;
  optionality: number;
  dominantShare: number;
  options: BrainOption[];
  lastUsed: string;
}

export interface Brain {
  stats: { questions: number; finalizedAnswers: number; settled: number; avgOptionality: number };
  entries: BrainEntry[];
}

export const parseCitations = (a: Answer | null): Citation[] => {
  if (!a) return [];
  try {
    return JSON.parse(a.citations_json) as Citation[];
  } catch {
    return [];
  }
};

export const parseOptions = (a: Answer | null): BrainOption[] => {
  if (!a) return [];
  try {
    return JSON.parse(a.source_options_json) as BrainOption[];
  } catch {
    return [];
  }
};
