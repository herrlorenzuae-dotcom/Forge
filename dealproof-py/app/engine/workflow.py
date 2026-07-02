"""Guided workflow — the step rail shown on every project page.

The steps mirror how the work actually proceeds:

  1 Project        name it, say which company the KYC is for
  2 Questionnaire  upload the bank's request; DealProof parses it
  3 Data           the entity profile — enter once or pull from the sources
  4 Answers        auto-answer (Brain / Quantium / YSolutions / web), then review
  5 Structure      the org chart — imported, taken over, or built
  6 Deliver        the original document filled in + the chart as PNG/PDF

Each step's status is computed live from the data, so the rail always shows
where the project stands. The KYC Brain deliberately sits OUTSIDE the rail —
it is the firm-wide memory, fed from past questionnaires."""
from ..db import db, rows, one


def _latest_questionnaire(con, project_id):
    return one(con, "SELECT id, reviewed_by FROM questionnaires WHERE client_id=? ORDER BY created_at DESC LIMIT 1", (project_id,))


def steps(project_id: str, active: str = "") -> list:
    with db() as con:
        proj = one(con, "SELECT * FROM clients WHERE id=?", (project_id,)) or {}
        qn = _latest_questionnaire(con, project_id)
        qid = qn["id"] if qn else None
        q_total = q_answered = q_flagged = 0
        if qid:
            q_total = one(con, "SELECT COUNT(*) c FROM questions WHERE questionnaire_id=?", (qid,))["c"]
            q_answered = one(con, """SELECT COUNT(*) c FROM answers a JOIN questions q ON q.id=a.question_id
                                     WHERE q.questionnaire_id=? AND a.value!=''""", (qid,))["c"]
            q_flagged = one(con, "SELECT COUNT(*) c FROM info_requests WHERE questionnaire_id=?", (qid,))["c"]
        ents = one(con, "SELECT COUNT(*) c FROM entities WHERE client_id=?", (project_id,))["c"]
        attrs = one(con, """SELECT COUNT(*) c FROM entity_attributes a JOIN entities e ON e.id=a.entity_id
                            WHERE e.client_id=? AND a.value!=''""", (project_id,))["c"]

    company = bool((proj.get("subject_company") or "").strip())
    base = f"/projects/{project_id}"

    def n(count, word):
        return f"{count} {word}{'' if count == 1 else 's'}"

    out = [
        {"key": "project", "label": "Project", "href": base,
         "done": company, "meta": (proj.get("subject_company") or "set the company")[:28]},
        {"key": "questionnaire", "label": "Questionnaire", "href": base,
         "done": bool(qid), "meta": n(q_total, "question") if qid else "upload the request"},
        {"key": "data", "label": "Data", "href": f"{base}/profile",
         "done": attrs >= 5, "meta": n(attrs, "field") + " on file" if attrs else "fill or pull"},
        {"key": "answers", "label": "Answers", "href": f"{base}/analysis/{qid}" if qid else base,
         "done": bool(qid) and q_total > 0 and (q_answered + q_flagged) >= q_total,
         "meta": f"{q_answered}/{q_total} answered" if qid else "after upload"},
        {"key": "structure", "label": "Structure", "href": f"{base}/structure",
         "done": ents > 1, "meta": n(ents, "entity").replace("entitys", "entities") if ents else "import or build"},
    ]
    reviewed = (qn or {}).get("reviewed_by", "") if qn else ""
    ready = out[3]["done"] and out[4]["done"]
    out.append({"key": "deliver", "label": "Deliver", "href": f"{base}/deliver",
                "done": bool(reviewed),
                "meta": f"reviewed by {reviewed}"[:26] if reviewed else ("ready to deliver" if ready else "final step")})
    # current = the active page if given, else the first not-done step
    cur = active if active in {s["key"] for s in out} else next((s["key"] for s in out if not s["done"]), "deliver")
    for s in out:
        s["current"] = s["key"] == cur
    return out
