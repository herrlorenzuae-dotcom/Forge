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


def brain_stats():
    with db() as con:
        lib = [dict(r) for r in con.execute("SELECT * FROM answer_library ORDER BY total DESC").fetchall()]
    entries = []
    for r in lib:
        variants = sorted(json.loads(r["variants_json"] or "[]"), key=lambda v: -v["count"])
        total = r["total"] or 1
        top = variants[0] if variants else {"value": "", "count": 0}
        entries.append({"prompt": r["sample_prompt"], "total": r["total"], "optionality": len(variants),
                        "convergence": top["count"] / total, "answer": top["value"]})
    return entries
