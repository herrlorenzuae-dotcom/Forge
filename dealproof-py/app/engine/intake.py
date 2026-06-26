"""Questionnaire intake — turn a pasted/extracted KYC document into atomic
questions.

Real KYC questionnaires are messy: long questions wrap across several lines when
a PDF is extracted, section headings sit between them, numbering lives in its own
column, and answer cells ("Y / N") trail the text. A naive "every line that ends
in ? is a question" splits one question into fragments and treats headings as
questions.

Two paths:
  1. Model-assisted (when an ANTHROPIC_API_KEY is set): the model reconstructs
     atomic questions, attaches the section, and ignores headings/answer cells.
  2. A reflow heuristic (always available): rebuild logical blocks from wrapped
     lines, classify headings vs questions, strip numbering and answer columns.
"""
import re
import json
from ..db import db, gen_id
from .. import config

# A line that starts a new item: "1.", "1.2", "1.2.3)", "(a)", "a)", "-", "•".
NUM_RE = re.compile(r"^\s*(?:\d+(?:\.\d+)*[.)]?|\([a-z0-9]{1,3}\)|[a-z][.)]|[-*•▪])\s+", re.I)
LEAD_RE = re.compile(r"^\s*(?:\d+(?:\.\d+)*[.)]?|\([a-z0-9]{1,3}\)|[a-z][.)]|[-*•▪])\s+", re.I)
# Trailing answer column / form artefacts to strip from a question.
ANSWER_TAIL = re.compile(
    r"\s*(?:[:\-–]\s*)?(?:y\s*/\s*n|yes\s*/\s*no|yes\s+no|true\s*/\s*false|n/?a|"
    r"☐|□|▢|◻|\[\s*\]|\(\s*\)|_{2,}|\.{3,}|select all that apply)\s*$", re.I)
INTERROGATIVE = re.compile(
    r"^(is|are|was|were|does|do|did|has|have|had|will|would|can|could|should|"
    r"may|might|please|provide|describe|list|state|specify|confirm|indicate|"
    r"name|identify|explain|detail|attach|upload|set out|give|"
    r"who|what|which|where|when|why|how)\b", re.I)


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


def _is_heading(block: str) -> bool:
    """A section heading: short, no question mark, mostly upper-case (after any
    leading number is stripped) — e.g. "1. ENTITY & OWNERSHIP"."""
    core = LEAD_RE.sub("", block).strip().rstrip(":")
    if not core or core.endswith("?"):
        return False
    letters = [c for c in core if c.isalpha()]
    if not letters:
        return False
    upper = sum(c.isupper() for c in letters) / len(letters)
    if len(core) <= 70 and upper >= 0.6:
        return True
    # Title-cased short phrase with no verb (e.g. "Products & Services"). Skip
    # numbered lines — a wrapped question start like "1.2 Legal Entity Identifier"
    # is title-cased too, but it's content, not a section heading.
    if not LEAD_RE.match(block) and len(core) <= 45 and core[0].isupper() \
            and not INTERROGATIVE.match(core) and not core.endswith("?"):
        words = core.split()
        if 1 <= len(words) <= 5 and all(w[0].isupper() or not w[0].isalpha() for w in words):
            return True
    return False


def _looks_like_question(block: str) -> bool:
    core = LEAD_RE.sub("", block).strip()
    if len(core) < 8:
        return False
    if core.endswith("?"):
        return True
    return bool(INTERROGATIVE.match(core))


def _clean(block: str) -> str:
    s = LEAD_RE.sub("", block).strip()
    prev = None
    while prev != s:  # answer column can appear more than once after a join
        prev = s
        s = ANSWER_TAIL.sub("", s).strip()
    return re.sub(r"\s{2,}", " ", s).strip(" -–:")


def _reflow(raw: str):
    """Group physical lines into logical blocks: a new block begins at a blank
    line, a numbered/bulleted item, or a heading; wrapped lines join with a
    space."""
    blocks, cur = [], []

    def flush():
        if cur:
            blocks.append(" ".join(cur).strip())
            cur.clear()

    for line0 in raw.splitlines():
        line = line0.strip()
        if not line:
            flush()
            continue
        if _is_heading(line):
            flush()
            blocks.append(line)  # standalone heading block
            continue
        if NUM_RE.match(line) and cur:
            flush()
        cur.append(line)
    flush()
    return blocks


def parse_questions_heuristic(raw: str):
    out, section, seen = [], "", set()
    for block in _reflow(raw):
        if _is_heading(block):
            section = LEAD_RE.sub("", block).strip().rstrip(":")
            continue
        # A block may pack several questions / a trailing instruction; split on
        # every '?' boundary so "...policy? Please provide..." becomes two.
        candidates = [c.strip() for c in re.split(r"(?<=\?)\s+", block)] if "?" in block else [block]
        for cand in candidates:
            if not _looks_like_question(cand):
                continue
            prompt = _clean(cand)
            key = prompt.lower()
            if len(prompt) < 8 or key in seen:
                continue
            seen.add(key)
            out.append({"section": section, "prompt": prompt, "kind": infer_kind(prompt)})
    return out


def parse_questions_model(raw: str):
    """Model-assisted extraction (needs a key). Returns the same shape as the
    heuristic, or None if it can't run."""
    if not config.HAS_KEY:
        return None
    try:
        import anthropic
        sys = (
            "You extract questions from a KYC / due-diligence questionnaire. The text "
            "comes from a PDF/Word export, so questions may be split across lines, "
            "section headings sit between them, numbering may be separated, and answer "
            "cells like 'Y / N' trail the text. Reconstruct each ATOMIC question as one "
            "clean sentence. Ignore pure headings (use them as the 'section'), page "
            "numbers, and answer cells. Return STRICT JSON: "
            "{\"questions\":[{\"section\":str,\"prompt\":str}]}. Keep wording faithful; "
            "do not invent questions."
        )
        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
        resp = client.messages.create(model=config.MODEL, max_tokens=4000, system=sys,
                                       messages=[{"role": "user", "content": raw[:24000]}])
        txt = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        a, b = txt.find("{"), txt.rfind("}")
        data = json.loads(txt[a:b + 1])
        out, seen = [], set()
        for q in data.get("questions", []):
            prompt = re.sub(r"\s{2,}", " ", (q.get("prompt") or "").strip())
            if len(prompt) < 6 or prompt.lower() in seen:
                continue
            seen.add(prompt.lower())
            out.append({"section": (q.get("section") or "").strip(), "prompt": prompt,
                        "kind": infer_kind(prompt)})
        return out or None
    except Exception:
        return None


def parse_questions_table(data: bytes):
    """Most KYC questionnaires are tables (No / Question / Answer). Reading the
    text flow scrambles those columns; pulling the table structure out of the
    PDF recovers clean questions and their sections. Returns the same shape, or
    None if no usable table is found."""
    try:
        import fitz
    except Exception:
        return None
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        return None
    out, section, seen = [], "", set()

    def add(sec, q):
        q = re.sub(r"\s{2,}", " ", q).strip(" -–")
        if len(q) < 6 or q.lower() == "question":
            return
        key = sec + "|" + q.lower()
        if key in seen:
            return
        seen.add(key)
        out.append({"section": sec, "prompt": q, "kind": infer_kind(q)})

    for pg in doc:
        try:
            tabs = pg.find_tables()
        except Exception:
            continue
        for t in tabs.tables:
            try:
                rows = t.extract()
            except Exception:
                continue
            # locate the Question column (by header on the first page, else col 1)
            qcol = 1
            if t.header and t.header.names:
                names = [(n or "").strip().lower() for n in t.header.names]
                if "question" in names:
                    qcol = names.index("question")
            for r in rows:
                no = (r[0] or "").strip() if len(r) > 0 else ""
                q = (r[qcol] or "").strip() if len(r) > qcol else ""
                if no and not q:                      # a section-header row
                    head = no.split("\n")[0].strip()  # ignore anything merged below it
                    core = re.sub(r"^\d+[.)]\s*", "", head).strip()
                    if _is_heading(head) or re.match(r"^\d+[.)]\s", head):
                        section = core
                    continue
                if not q:
                    continue
                no_lines = [x for x in no.split("\n") if x.strip()]
                q_lines = [x.strip() for x in q.split("\n") if x.strip()]
                # a cell that packs several numbered sub-items, one per line
                if len(no_lines) > 1 and len(no_lines) == len(q_lines):
                    for ql in q_lines:
                        add(section, ql)
                else:
                    add(section, " ".join(q_lines))
    return out or None


def parse_document(raw_text: str, filename: str = "", content: bytes = b""):
    """Pick the best extractor: table structure for PDFs, then model, then the
    text reflow heuristic."""
    if (filename or "").lower().endswith(".pdf") and content:
        tabular = parse_questions_table(content)
        if tabular and len(tabular) >= 5:
            return tabular
    return parse_questions(raw_text)


def parse_questions(raw: str):
    """Model first (if a key is configured), heuristic otherwise/as fallback."""
    return parse_questions_model(raw) or parse_questions_heuristic(raw)


def create_questionnaire(client_id: str, requester: str, title: str, raw_text: str,
                         filename: str = "", content: bytes = b"") -> str:
    qs = parse_document(raw_text, filename, content)
    qid = gen_id("qn")
    with db() as con:
        con.execute("INSERT INTO questionnaires (id, client_id, requester, title, status) VALUES (?,?,?,?,'parsed')",
                    (qid, client_id, requester, title))
        for i, q in enumerate(qs):
            con.execute("INSERT INTO questions (id, questionnaire_id, position, section, prompt, kind) VALUES (?,?,?,?,?,?)",
                        (gen_id("q"), qid, i, q["section"], q["prompt"], q["kind"]))
    return qid
