"""KYC Brain — folds finalized answers into a library keyed by the normalized
question; recurring questions converge on a dominant answer."""
import json
import re
from ..db import db, gen_id, one

STOP = {"the", "a", "an", "of", "for", "to", "is", "are", "please", "kindly", "provide", "state",
        "your", "you", "and", "or", "in", "on", "with", "this", "that", "any", "each", "all", "we",
        "do", "does", "has", "have", "what", "which", "name", "list"}


def normalize_question(prompt: str) -> str:
    toks = [t for t in re.sub(r"[^a-z0-9%\s]", " ", prompt.lower()).split() if t and t not in STOP]
    return " ".join(sorted(toks)).strip()


def get_brain_options(prompt: str):
    key = normalize_question(prompt)
    with db() as con:
        row = one(con, "SELECT * FROM answer_library WHERE norm_question=?", (key,))
    if not row:
        return []
    variants = json.loads(row["variants_json"] or "[]")
    total = row["total"] or sum(v["count"] for v in variants) or 1
    variants.sort(key=lambda v: -v["count"])
    return [{"value": v["value"], "timesUsed": v["count"], "share": v["count"] / total} for v in variants]


def record_finalized_answer(prompt: str, value: str) -> None:
    if not value.strip():
        return
    key = normalize_question(prompt)
    with db() as con:
        row = one(con, "SELECT * FROM answer_library WHERE norm_question=?", (key,))
        if row:
            variants = json.loads(row["variants_json"] or "[]")
            for v in variants:
                if v["value"] == value:
                    v["count"] += 1
                    break
            else:
                variants.append({"value": value, "count": 1})
            con.execute("UPDATE answer_library SET variants_json=?, total=total+1, sample_prompt=?, updated_at=datetime('now') WHERE id=?",
                        (json.dumps(variants), prompt, row["id"]))
        else:
            con.execute("INSERT INTO answer_library (id, norm_question, sample_prompt, variants_json, total) VALUES (?,?,?,?,1)",
                        (gen_id("lib"), key, prompt, json.dumps([{"value": value, "count": 1}])))


# answer-cell values that aren't real answers (don't learn these)
NON_ANSWERS = {"", "n/a", "na", "n.a.", "none", "please select", "-", "–", "tbd", "yes/no", "y/n"}


def learn_from_document(filename: str, content: bytes, raw_text: str = "") -> dict:
    """Seed the Brain from a PAST, already-answered questionnaire: extract each
    question + its given answer and fold it in. Existing cases entered this way
    become the basis the connectors (Quantium / YSolutions) only verify.
    A Transparenzregister extract is recognised and handled as what it is: the
    beneficial owners are learned under the company they belong to.
    Returns {total, learned, skipped[, kind, company]}."""
    from .intake import parse_document, docx_qa_pairs
    from . import transparency, chartpdf
    # a drawn structure chart is structural data, not Q&A — recognise it and
    # point the user to the right place instead of "learning 0 answers"
    if (filename or "").lower().endswith(".pdf") and content and chartpdf.is_chart_pdf(content):
        spec = chartpdf.extract_spec(content) or {"entities": [], "edges": []}
        return {"total": len(spec["edges"]), "learned": len(spec["entities"]),
                "skipped": 0, "kind": "structurechart", "company": ""}
    if raw_text and transparency.is_tr_extract(raw_text):
        ubos = transparency.extract_ubos(raw_text)
        if ubos:                                   # a blank UBO form falls through
            company = transparency.tr_company(raw_text)
            transparency.learn_ubos_into_brain(ubos, company=company)
            return {"total": len(ubos), "learned": len(ubos),
                    "skipped": 0, "kind": "transparenzregister", "company": company}
    name = (filename or "").lower()
    if name.endswith(".docx") and content:
        pairs = docx_qa_pairs(content)
    else:  # PDF (table/markdown captures the answer cell) and anything else
        pairs = [(q["prompt"], q.get("answer", "")) for q in parse_document(raw_text, filename, content)]
    learned = skipped = 0
    for prompt, ans in pairs:
        ans = (ans or "").strip()
        if prompt and ans and ans.lower() not in NON_ANSWERS:
            record_finalized_answer(prompt, ans)
            learned += 1
        else:
            skipped += 1
    return {"total": len(pairs), "learned": learned, "skipped": skipped}


def brain_stats():
    with db() as con:
        lib = [dict(r) for r in con.execute("SELECT * FROM answer_library ORDER BY total DESC").fetchall()]
    entries = []
    for r in lib:
        variants = sorted(json.loads(r["variants_json"] or "[]"), key=lambda v: -v["count"])
        total = r["total"] or 1
        top = variants[0] if variants else {"value": "", "count": 0}
        entries.append({"id": r["id"], "prompt": r["sample_prompt"], "total": r["total"],
                        "optionality": len(variants), "convergence": top["count"] / total,
                        "answer": top["value"]})
    return entries


def update_entry(entry_id: str, value: str) -> None:
    """Correct a learned answer: the given value becomes THE canonical answer
    (all previous variants are replaced, convergence resets to 100%)."""
    value = (value or "").strip()
    if not value:
        return
    with db() as con:
        row = one(con, "SELECT total FROM answer_library WHERE id=?", (entry_id,))
        if row:
            total = max(row["total"] or 1, 1)
            con.execute("UPDATE answer_library SET variants_json=?, updated_at=datetime('now') WHERE id=?",
                        (json.dumps([{"value": value, "count": total}]), entry_id))


def delete_entry(entry_id: str) -> None:
    """Forget a learned question/answer entirely."""
    with db() as con:
        con.execute("DELETE FROM answer_library WHERE id=?", (entry_id,))
