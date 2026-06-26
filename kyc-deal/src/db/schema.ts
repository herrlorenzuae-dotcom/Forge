/**
 * KYC Deal ontology — the client's structure is the source of truth, and
 * every questionnaire answer maps back to it.
 *
 * clients → entities → ownership_edges / ubos / entity_attributes (the
 * "result": the structure that barely changes between deals). Incoming
 * questionnaires → questions → answers, each answer citing the structure
 * facts it rests on. Finalized answers flow into answer_library — the KYC
 * Brain — so recurring questions converge on a settled answer over time.
 * Every frontier call is audited in ai_calls; connector pulls in source_syncs.
 */

import type Database from 'better-sqlite3';

const TABLES = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  deal_name TEXT NOT NULL DEFAULT '',
  asset TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('individual','operating','holding','spv','fund','trust','partnership','foundation')),
  role TEXT NOT NULL CHECK (role IN ('acquisition_vehicle','topco','intermediate','ubo','target','other')),
  jurisdiction TEXT NOT NULL DEFAULT '',
  registration_no TEXT NOT NULL DEFAULT '',
  incorporation_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL CHECK (source IN ('quantium','ysolutions','manual')),
  source_ref TEXT NOT NULL DEFAULT '',
  as_of TEXT NOT NULL DEFAULT (date('now')),
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ownership_edges (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  parent_id TEXT NOT NULL REFERENCES entities(id),
  child_id TEXT NOT NULL REFERENCES entities(id),
  pct REAL NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('shares','partnership_interest','beneficial','control')),
  mechanism TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('quantium','ysolutions','manual')),
  source_ref TEXT NOT NULL DEFAULT '',
  as_of TEXT NOT NULL DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS ubos (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  entity_id TEXT NOT NULL REFERENCES entities(id),
  basis TEXT NOT NULL CHECK (basis IN ('ownership','control','senior_managing_official')),
  pct REAL NOT NULL DEFAULT 0,
  pep INTEGER NOT NULL DEFAULT 0,
  residence TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('quantium','ysolutions','manual')),
  source_ref TEXT NOT NULL DEFAULT '',
  as_of TEXT NOT NULL DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS entity_attributes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  entity_id TEXT NOT NULL REFERENCES entities(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('quantium','ysolutions','manual')),
  source_ref TEXT NOT NULL DEFAULT '',
  as_of TEXT NOT NULL DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS questionnaires (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  requester TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'pasted',
  raw_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'parsed' CHECK (status IN ('parsed','mapped','finalized')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id),
  position INTEGER NOT NULL DEFAULT 0,
  section TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','yesno','entity','ubo_list','pct','date','choice','number')),
  options_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL UNIQUE REFERENCES questions(id),
  value TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','edited')),
  needs_review INTEGER NOT NULL DEFAULT 0,
  citations_json TEXT NOT NULL DEFAULT '[]',
  source_options_json TEXT NOT NULL DEFAULT '[]',
  answered_by TEXT NOT NULL DEFAULT 'model' CHECK (answered_by IN ('model','brain','human')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The KYC Brain. One row per normalized question seen across finalized
-- questionnaires; variants_json holds every distinct value with its count,
-- so optionality (distinct answers) and convergence (dominant share) are
-- both readable straight off the row.
CREATE TABLE IF NOT EXISTS answer_library (
  id TEXT PRIMARY KEY,
  question_norm TEXT NOT NULL UNIQUE,
  sample_prompt TEXT NOT NULL,
  question_kind TEXT NOT NULL DEFAULT 'text',
  variants_json TEXT NOT NULL DEFAULT '[]',
  times_used INTEGER NOT NULL DEFAULT 0,
  last_used TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS source_syncs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  connector TEXT NOT NULL,
  op TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 1,
  items INTEGER NOT NULL DEFAULT 0,
  stale_items INTEGER NOT NULL DEFAULT 0,
  as_of TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_calls (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  stage TEXT NOT NULL,
  model TEXT NOT NULL,
  sanitized_prompt TEXT NOT NULL,
  entity_stats_json TEXT NOT NULL DEFAULT '{}',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS info_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  questionnaire_id TEXT,
  question_id TEXT,
  field_type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  channel TEXT NOT NULL,           -- 'web' | 'request'
  source TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',  -- open | requested | received | verified | na
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entities_client ON entities(client_id);
CREATE INDEX IF NOT EXISTS idx_edges_client ON ownership_edges(client_id);
CREATE INDEX IF NOT EXISTS idx_ubos_client ON ubos(client_id);
CREATE INDEX IF NOT EXISTS idx_attrs_entity ON entity_attributes(entity_id);
CREATE INDEX IF NOT EXISTS idx_questions_qn ON questions(questionnaire_id);
CREATE INDEX IF NOT EXISTS idx_questionnaires_client ON questionnaires(client_id);
CREATE INDEX IF NOT EXISTS idx_syncs_client ON source_syncs(client_id);
CREATE INDEX IF NOT EXISTS idx_requests_client ON info_requests(client_id);
`;

/** Idempotent column additions for databases created before a column existed.
 *  SQLite has no "ADD COLUMN IF NOT EXISTS", so check pragma first. */
function migrateColumns(db: Database.Database): void {
  const cols = (table: string): Set<string> =>
    new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name));
  const edgeCols = cols('ownership_edges');
  if (edgeCols.size > 0 && !edgeCols.has('mechanism')) {
    db.exec(`ALTER TABLE ownership_edges ADD COLUMN mechanism TEXT NOT NULL DEFAULT ''`);
  }
}

export function initSchema(db: Database.Database): void {
  db.exec(TABLES);
  migrateColumns(db);
}
