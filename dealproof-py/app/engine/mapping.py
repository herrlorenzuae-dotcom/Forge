"""Mapping — answer a question against the structure. With a model key the
model drafts cited answers; without one the KYC Brain answers from the corpus."""
import json
from ..db import db, one, rows
from .structure import structure_context
from .brain import get_brain_options
from .citations import verify_citations
from . import connectors
from .. import llm

# values in a source "answer" cell that aren't really answers
NON_ANSWERS = {"", "n/a", "na", "n.a.", "none", "please select", "-", "–", "tbd", "yes/no", "y/n"}


def has_source_answer(q) -> bool:
    v = (q.get("source_answer") or "").strip()
    return bool(v) and v.lower() not in NON_ANSWERS


def _save(qid, value, rationale, confidence, citations, options, answered_by):
    needs = 0 if any(c.get("verified") for c in citations) else 1
    with db() as con:
        con.execute(
            """INSERT INTO answers (question_id, value, rationale, confidence, status, needs_review, citations_json, source_options_json, answered_by, updated_at)
               VALUES (?,?,?,?, 'proposed', ?,?,?,?, datetime('now'))
               ON CONFLICT(question_id) DO UPDATE SET value=excluded.value, rationale=excluded.rationale,
                 confidence=excluded.confidence, needs_review=excluded.needs_review, citations_json=excluded.citations_json,
                 source_options_json=excluded.source_options_json, answered_by=excluded.answered_by, updated_at=datetime('now')""",
            (qid, value, rationale, confidence, needs, json.dumps(citations), json.dumps(options), answered_by))


def answer_question(question_id: str) -> dict:
    with db() as con:
        q = one(con, "SELECT q.*, qn.client_id FROM questions q JOIN questionnaires qn ON qn.id=q.questionnaire_id WHERE q.id=?", (question_id,))
    if not q:
        raise ValueError("question not found")
    options = get_brain_options(q["prompt"])
    # 0) An answer already present in the source document (a completed form /
    #    prior submission) — the most authoritative starting point.
    if has_source_answer(q):
        val = q["source_answer"].strip()
        cite = [{"factType": "source", "factId": "", "quote": val, "verified": True, "source": "Source document"}]
        _save(question_id, val, "Already answered in the source document.", 0.95, cite, options, "source")
        return {"answered_by": "source", "value": val}
    # 1) Brain: a strongly-converged prior answer
    if options and options[0]["share"] >= 0.5:
        top = options[0]
        _save(question_id, top["value"], "From the KYC Brain (dominant prior answer).", round(top["share"], 2), [], options, "brain")
        return {"answered_by": "brain", "value": top["value"]}
    # 2) Connectors / on-file (Quantium, YSolutions, Web, structure facts)
    conn = connectors.answer(q["client_id"], q["prompt"])
    if conn:
        cite = [{"factType": conn["source"], "factId": "", "quote": conn["value"], "verified": True, "source": conn["source_label"]}]
        _save(question_id, conn["value"], conn["detail"], 0.85, cite, options, conn["source"])
        return {"answered_by": conn["source"], "value": conn["value"]}
    # 3) Model (only if a key is configured)
    if llm.available():
        try:
            res = llm.answer(q["client_id"], q["prompt"], structure_context(q["client_id"]))
            cites = verify_citations(res.get("citations", []))
            conf = 0.9 if any(c.get("verified") for c in cites) else 0.4
            _save(question_id, res["value"], res.get("rationale", ""), conf, cites, options, "model")
            return {"answered_by": "model", "value": res["value"]}
        except Exception as e:  # noqa
            _save(question_id, "", f"Model error: {e}", 0, [], options, "model")
            return {"answered_by": "model", "value": ""}
    # 3) Nothing to go on
    _save(question_id, "", "No prior answer and no model key.", 0, [], options, "human")
    return {"answered_by": "human", "value": ""}


def answer_all(questionnaire_id: str) -> int:
    with db() as con:
        qids = [r["id"] for r in rows(con, "SELECT id FROM questions WHERE questionnaire_id=?", (questionnaire_id,))]
    for qid in qids:
        answer_question(qid)
    with db() as con:
        con.execute("UPDATE questionnaires SET status='mapped' WHERE id=?", (questionnaire_id,))
    return len(qids)


def set_answer(question_id: str, value: str):
    with db() as con:
        con.execute(
            """INSERT INTO answers (question_id, value, status, answered_by, updated_at) VALUES (?,?, 'edited','human', datetime('now'))
               ON CONFLICT(question_id) DO UPDATE SET value=excluded.value, status='edited', answered_by='human', updated_at=datetime('now')""",
            (question_id, value))


def finalize(questionnaire_id: str) -> int:
    from .brain import record_finalized_answer
    with db() as con:
        qs = rows(con, "SELECT q.prompt, a.value FROM questions q LEFT JOIN answers a ON a.question_id=q.id WHERE q.questionnaire_id=?", (questionnaire_id,))
        con.execute("UPDATE questionnaires SET status='finalized' WHERE id=?", (questionnaire_id,))
    folded = 0
    for q in qs:
        if q["value"]:
            record_finalized_answer(q["prompt"], q["value"])
            folded += 1
    return folded
