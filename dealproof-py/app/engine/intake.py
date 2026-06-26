"""Questionnaire intake — split pasted text into atomic questions. Heuristic
parser (no model needed); the model path can be added later."""
import re
from ..db import db, gen_id


def infer_kind(prompt: str) -> str:
    p = prompt.lower()
    if re.search(r"\b(y/n|yes/no|yes or no)\b", p) or re.match(r"^(is|are|does|do|has|have|will)\b", p):
        return "yesno"
    if re.search(r"\b(percent|percentage|%|shareholding|ownership stake)\b", p):
        return "pct"
    if re.search(r"\b(date|incorporat|established|founded)\b", p):
        return "date"
    if re.search(r"\b(ubo|beneficial owner|controlling person)\b", p):
        return "ubo_list"
    if re.search(r"\b(name of|legal name|company|entity|registered)\b", p):
        return "entity"
    return "text"


def parse_questions(raw: str):
    out, section = [], ""
    for line0 in raw.splitlines():
        line = line0.strip()
        if not line:
            continue
        is_q = bool(re.search(r"\?\s*$", line) or re.match(r"^\s*(\d+[.)]|[-*•]|[a-z][.)])\s+", line, re.I))
        if not is_q:
            # short heading-like line becomes the running section
            if len(line) < 60 and not line.endswith("."):
                section = line
            continue
        prompt = re.sub(r"^\s*(\d+[.)]|[-*•]|[a-z][.)])\s+", "", line).strip()
        if prompt:
            out.append({"section": section, "prompt": prompt, "kind": infer_kind(prompt)})
    return out


def create_questionnaire(client_id: str, requester: str, title: str, raw_text: str) -> str:
    qs = parse_questions(raw_text)
    qid = gen_id("qn")
    with db() as con:
        con.execute("INSERT INTO questionnaires (id, client_id, requester, title, status) VALUES (?,?,?,?,'parsed')",
                    (qid, client_id, requester, title))
        for i, q in enumerate(qs):
            con.execute("INSERT INTO questions (id, questionnaire_id, position, section, prompt, kind) VALUES (?,?,?,?,?,?)",
                        (gen_id("q"), qid, i, q["section"], q["prompt"], q["kind"]))
    return qid
