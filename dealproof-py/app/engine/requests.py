"""Manual-input items — open coverage items that can't be answered from data,
connectors or web become tracked internal to-dos with a lifecycle
(open→in progress→added→verified/na)."""
from ..db import db, gen_id, rows, one
from .coverage import build_coverage


def list_requests(client_id: str):
    with db() as con:
        return rows(con, "SELECT * FROM info_requests WHERE client_id=? ORDER BY channel, field_type, created_at", (client_id,))


def generate_requests(questionnaire_id: str):
    with db() as con:
        qn = one(con, "SELECT * FROM questionnaires WHERE id=?", (questionnaire_id,))
        if not qn:
            raise ValueError("questionnaire not found")
        existing = {r["question_id"] for r in rows(con, "SELECT question_id FROM info_requests WHERE questionnaire_id=?", (questionnaire_id,))}
    report = build_coverage(questionnaire_id)
    created = []
    with db() as con:
        for it in report["items"]:
            if it["status"] == "answered" or it["questionId"] in existing:
                continue
            rid = gen_id("req")
            con.execute("INSERT INTO info_requests (id, client_id, questionnaire_id, question_id, field_type, prompt, channel, source, status) VALUES (?,?,?,?,?,?,?,?, 'open')",
                        (rid, qn["client_id"], questionnaire_id, it["questionId"], it["field"]["fieldType"], it["prompt"], it.get("gapKind", "request"), it.get("source", "")))
            created.append(rid)
    return created


def update_request(req_id: str, status: str = None, note: str = None):
    with db() as con:
        cur = one(con, "SELECT * FROM info_requests WHERE id=?", (req_id,))
        if not cur:
            return None
        con.execute("UPDATE info_requests SET status=?, note=?, updated_at=datetime('now') WHERE id=?",
                    (status or cur["status"], note if note is not None else cur["note"], req_id))
        return one(con, "SELECT * FROM info_requests WHERE id=?", (req_id,))


def render_request_list(client_id: str) -> str:
    rows_ = [r for r in list_requests(client_id) if r["channel"] == "request" and r["status"] not in ("verified", "na")]
    if not rows_:
        return "No open items."
    lines = ["To add manually (internal KYC items):", ""]
    for i, r in enumerate(rows_, 1):
        lines.append(f"{i}. {r['prompt']}  —  Source: {r['source']}")
    return "\n".join(lines)
