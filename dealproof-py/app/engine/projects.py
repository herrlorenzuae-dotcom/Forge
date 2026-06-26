"""Projects — a project is one KYC matter. Named on the landing page, persisted,
and reopenable. Documents (the KYC questionnaires to answer) attach to a project."""
from ..db import db, gen_id, rows, one
from .intake import create_questionnaire, parse_document


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


def add_document(pid: str, filename: str, raw_text: str, requester: str = "", content: bytes = b"") -> dict:
    """Store a document (with its original bytes, so answers can later be filled
    back into the exact file) and parse it into a questionnaire."""
    title = filename.rsplit(".", 1)[0] if filename else "Questionnaire"
    qid = create_questionnaire(pid, requester or "Uploaded", title, raw_text, filename, content)
    did = gen_id("doc")
    blob = content if content else raw_text.encode("utf-8")
    with db() as con:
        con.execute("INSERT INTO documents (id, project_id, questionnaire_id, filename, size, content) VALUES (?,?,?,?,?,?)",
                    (did, pid, qid, filename or "pasted.txt", len(blob), blob))
    touch(pid)
    return {"document_id": did, "questionnaire_id": qid, "questions": len(parse_document(raw_text, filename, content))}


def original_document(questionnaire_id: str):
    """The stored original file for a questionnaire (filename + bytes), if any."""
    with db() as con:
        return one(con, "SELECT filename, content FROM documents WHERE questionnaire_id=? ORDER BY uploaded_at DESC LIMIT 1",
                   (questionnaire_id,))
