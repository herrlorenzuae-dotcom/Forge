"""Projects — a project is one KYC matter. Named on the landing page, persisted,
and reopenable. Documents (the KYC questionnaires to answer) attach to a project."""
from ..db import db, gen_id, rows, one
from .intake import create_questionnaire, parse_questions


def create_project(name: str) -> str:
    pid = gen_id("proj")
    with db() as con:
        con.execute("INSERT INTO clients (id, name, status) VALUES (?,?, 'open')", (pid, name.strip() or "Untitled project"))
    return pid


def list_projects():
    with db() as con:
        return rows(con, """SELECT c.*,
            (SELECT COUNT(*) FROM documents d WHERE d.project_id=c.id) AS doc_count,
            (SELECT COUNT(*) FROM questionnaires q WHERE q.client_id=c.id) AS qn_count
            FROM clients c ORDER BY c.updated_at DESC""")


def get_project(pid: str):
    with db() as con:
        return one(con, "SELECT * FROM clients WHERE id=?", (pid,))


def touch(pid: str):
    with db() as con:
        con.execute("UPDATE clients SET updated_at=datetime('now') WHERE id=?", (pid,))


def list_documents(pid: str):
    with db() as con:
        return rows(con, "SELECT * FROM documents WHERE project_id=? ORDER BY uploaded_at DESC", (pid,))


def add_document(pid: str, filename: str, raw_text: str, requester: str = "") -> dict:
    """Store a document and parse it into a questionnaire bound to the project."""
    title = filename.rsplit(".", 1)[0] if filename else "Questionnaire"
    qid = create_questionnaire(pid, requester or "Uploaded", title, raw_text)
    did = gen_id("doc")
    with db() as con:
        con.execute("INSERT INTO documents (id, project_id, questionnaire_id, filename, size) VALUES (?,?,?,?,?)",
                    (did, pid, qid, filename or "pasted.txt", len(raw_text)))
    touch(pid)
    return {"document_id": did, "questionnaire_id": qid, "questions": len(parse_questions(raw_text))}
