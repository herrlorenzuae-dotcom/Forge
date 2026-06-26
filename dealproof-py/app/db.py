"""SQLite access + schema. Mirrors the DealProof ontology: a client's structure
(entities, ownership/control edges, UBOs, attributes) is the source of truth;
questionnaires map onto it; finalized answers fold into the KYC Brain."""
import sqlite3
import secrets
from contextlib import contextmanager
from . import config

SCHEMA = """
-- A "project" is one KYC matter (named by the user, persisted, reopenable).
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, deal_name TEXT DEFAULT '',
  status TEXT DEFAULT 'open', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, questionnaire_id TEXT DEFAULT '',
  filename TEXT NOT NULL, kind TEXT DEFAULT 'questionnaire', size INTEGER DEFAULT 0,
  content BLOB, uploaded_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'other', jurisdiction TEXT DEFAULT '', registration_no TEXT DEFAULT '',
  incorporation_date TEXT DEFAULT '', status TEXT DEFAULT 'active', as_of TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ownership_edges (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, parent_id TEXT NOT NULL, child_id TEXT NOT NULL,
  pct REAL NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'shares', mechanism TEXT DEFAULT '', as_of TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ubos (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, entity_id TEXT NOT NULL, basis TEXT NOT NULL,
  pct REAL NOT NULL DEFAULT 0, pep INTEGER NOT NULL DEFAULT 0, residence TEXT DEFAULT '', as_of TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS entity_attributes (
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT DEFAULT '',
  source TEXT DEFAULT '', as_of TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS questionnaires (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, requester TEXT DEFAULT '', title TEXT DEFAULT '',
  format TEXT DEFAULT '', status TEXT DEFAULT 'new', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY, questionnaire_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
  section TEXT DEFAULT '', prompt TEXT NOT NULL, kind TEXT DEFAULT 'text', options_json TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS answers (
  question_id TEXT PRIMARY KEY, value TEXT DEFAULT '', rationale TEXT DEFAULT '', confidence REAL DEFAULT 0,
  status TEXT DEFAULT 'proposed', needs_review INTEGER DEFAULT 0, citations_json TEXT DEFAULT '[]',
  source_options_json TEXT DEFAULT '[]', answered_by TEXT DEFAULT 'model', updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS answer_library (
  id TEXT PRIMARY KEY, norm_question TEXT NOT NULL, sample_prompt TEXT DEFAULT '', variants_json TEXT DEFAULT '[]',
  total INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS info_requests (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, questionnaire_id TEXT DEFAULT '', question_id TEXT DEFAULT '',
  field_type TEXT NOT NULL, prompt TEXT NOT NULL, channel TEXT NOT NULL, source TEXT DEFAULT '',
  status TEXT DEFAULT 'open', note TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_calls (
  id TEXT PRIMARY KEY, ts TEXT DEFAULT (datetime('now')), stage TEXT, model TEXT,
  sanitized_prompt TEXT, masked INTEGER DEFAULT 0, ok INTEGER DEFAULT 1
);
"""


def gen_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(config.DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


@contextmanager
def db():
    con = connect()
    try:
        yield con
        con.commit()
    finally:
        con.close()


# Columns added after the first release — applied to pre-existing DBs so the
# schema self-heals without dropping data. (SQLite ALTER ADD needs a constant
# default, so updated_at backfills to '' on old rows.)
MIGRATIONS = {
    "clients": [("status", "TEXT DEFAULT 'open'"), ("updated_at", "TEXT DEFAULT ''")],
    "documents": [("content", "BLOB")],
}


def _migrate(con) -> None:
    for table, cols in MIGRATIONS.items():
        existing = {r["name"] for r in con.execute(f"PRAGMA table_info({table})").fetchall()}
        for name, decl in cols:
            if name not in existing:
                con.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")


def init_db() -> None:
    with db() as con:
        con.executescript(SCHEMA)
        _migrate(con)


def rows(con, sql, params=()):
    return [dict(r) for r in con.execute(sql, params).fetchall()]


def one(con, sql, params=()):
    r = con.execute(sql, params).fetchone()
    return dict(r) if r else None
