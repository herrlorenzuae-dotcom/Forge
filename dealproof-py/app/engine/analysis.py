"""Analysis report — for an uploaded questionnaire, decide for each question
WHERE the answer can come from:

  on_file   — already held in the project's structure facts
  brain     — answered & verified before (flagged if the same questionnaire)
  quantium  — corporate registry / structure connector
  ysolutions— screening / softer-KYC connector
  web       — public sources (GLEIF, registers)
  manual    — not available from data/connectors/web; must be added manually

Produces the overview the user reviews before answering."""
from ..db import db, rows
from .coverage import classify_field
from .brain import get_brain_options, normalize_question
from .structure import get_structure

# field_type -> (source, retrievable?)
SOURCE = {
    "registration_number": ("quantium", True),
    "registered_office": ("quantium", True),
    "incorporation_date": ("quantium", True),
    "legal_form": ("quantium", True),
    "directors": ("quantium", True),
    "lei": ("web", True),
    "listing": ("web", True),
    "industry": ("web", True),
    "beneficial_owner": ("ysolutions", True),
    "pep": ("request", False),
    "tax_residence": ("request", False),
    "source_of_funds": ("request", False),
    "id_document": ("request", False),
    "certified_document": ("request", False),
    "bank_reference": ("request", False),
    "signatory": ("request", False),
    "purpose_of_relationship": ("request", False),
    "expected_volume": ("request", False),
    "personal_details": ("request", False),
    "other": ("request", False),
}

SOURCE_LABEL = {
    "source": "In source", "on_file": "On file", "brain": "KYC Brain", "quantium": "Quantium",
    "ysolutions": "YSolutions", "web": "Web research", "request": "Manual input",
}

# values in a source "answer" cell that aren't really answers
NON_ANSWERS = {"", "n/a", "na", "n.a.", "none", "please select", "-", "–", "tbd", "yes/no", "y/n"}


def _source_answer(q) -> bool:
    v = (q.get("source_answer") or "").strip()
    return bool(v) and v.lower() not in NON_ANSWERS


def _on_file(structure, field_type) -> bool:
    keys = " ".join(a["key"].lower() for a in structure["attributes"])
    needle = {"registration_number": "registration", "registered_office": "registered address",
              "incorporation_date": "incorporation", "lei": "lei", "tax_residence": "tax",
              "source_of_funds": "source of funds", "pep": "pep"}.get(field_type)
    return bool(needle and needle in keys)


def build_analysis(questionnaire_id: str) -> dict:
    with db() as con:
        qs = rows(con, "SELECT * FROM questions WHERE questionnaire_id=? ORDER BY position", (questionnaire_id,))
        qn = rows(con, "SELECT * FROM questionnaires WHERE id=?", (questionnaire_id,))
        pid = qn[0]["client_id"] if qn else None
    structure = get_structure(pid) if pid else {"entities": [], "edges": [], "ubos": [], "attributes": []}

    items = []
    for q in qs:
        field = classify_field(q["prompt"])
        ft = field["fieldType"]
        opts = get_brain_options(q["prompt"])
        if _source_answer(q):
            source, retrievable = "source", True
            detail = "Already answered in the source document."
        elif opts and opts[0]["share"] >= 0.5:
            source, retrievable = "brain", True
            detail = f"Previously verified answer — used {opts[0]['timesUsed']}× ({int(opts[0]['share']*100)}% agreement)."
        elif _on_file(structure, ft):
            source, retrievable, detail = "on_file", True, "Already held in the project's structure facts."
        else:
            source, retrievable = SOURCE[ft]
            detail = field["source"]
        items.append({"questionId": q["id"], "prompt": q["prompt"], "fieldType": ft,
                      "section": q["section"] or "", "source": source, "sourceLabel": SOURCE_LABEL[source],
                      "retrievable": retrievable, "detail": detail})

    by = {}
    for it in items:
        by[it["source"]] = by.get(it["source"], 0) + 1
    auto = sum(1 for it in items if it["retrievable"])
    sections = list(dict.fromkeys(it["section"] for it in items))
    return {"questionnaireId": questionnaire_id, "total": len(items), "auto": auto,
            "request": len(items) - auto, "bySource": by, "items": items,
            "sections": sections, "coverage": (auto / len(items)) if items else 0}
