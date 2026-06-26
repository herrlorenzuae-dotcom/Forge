"""Connectors — answer the retrievable questions. Today these return MOCK data
(clearly fictional placeholders) so Answer-all fills the Quantium / YSolutions /
Web / On-file questions, not only the Brain ones. Swapping in live queries later
means replacing the lookup bodies; the wiring in mapping stays the same.

On-file values are read from the project's real structure facts; the rest are
fictional sample values for the demo until the live connectors are wired."""
from ..db import db, rows, one
from .coverage import classify_field

# field_type -> source connector for the retrievable fields
SOURCE = {
    "registration_number": "quantium", "registered_office": "quantium",
    "incorporation_date": "quantium", "legal_form": "quantium", "directors": "quantium",
    "lei": "web", "listing": "web", "industry": "web",
    "pep": "ysolutions", "tax_residence": "ysolutions",
}

# Mock sample answers (fictional) keyed by field_type
MOCK = {
    "registration_number": "RCS Luxembourg B 248 115",
    "registered_office": "12, rue Eugène Ruppert, L-2453 Luxembourg",
    "incorporation_date": "14 March 2023",
    "legal_form": "Société à responsabilité limitée (S.à r.l.)",
    "directors": "Sophie Marchetti; Jean-Marc Weber",
    "lei": "529900HALCYONBIDCO45 (GLEIF — status: issued)",
    "listing": "Not listed on any stock exchange.",
    "industry": "Real-estate holding / logistics.",
    "pep": "Screening clear — no beneficial owner identified as a politically exposed person.",
    "tax_residence": "Luxembourg; CRS/FATCA classification: Passive NFE.",
}
LABEL = {"quantium": "Quantium", "ysolutions": "YSolutions", "web": "Web research", "on_file": "On file"}


def _on_file_value(project_id: str, field_type: str):
    needle = {"registration_number": "registration", "registered_office": "registered address",
              "incorporation_date": "incorporation", "lei": "lei", "tax_residence": "tax",
              "source_of_funds": "source of funds", "pep": "pep"}.get(field_type)
    if not needle:
        return None
    with db() as con:
        for a in rows(con, "SELECT a.key, a.value, a.source FROM entity_attributes a JOIN entities e ON e.id=a.entity_id WHERE e.client_id=?", (project_id,)):
            if needle in a["key"].lower():
                return a
    return None


def answer(project_id: str, prompt: str):
    """Return {value, source, source_label, detail} for a retrievable question,
    or None if it isn't connector/on-file answerable."""
    ft = classify_field(prompt)["fieldType"]

    onf = _on_file_value(project_id, ft)
    if onf:
        return {"value": onf["value"], "source": "on_file", "source_label": "On file",
                "detail": f"Held in the project's structure facts (source: {onf['source'] or 'on file'})."}

    src = SOURCE.get(ft)
    if src and ft in MOCK:
        return {"value": MOCK[ft], "source": src, "source_label": LABEL[src],
                "detail": f"Mock {LABEL[src]} data — replace with a live query."}
    return None
