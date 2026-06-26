"""Coverage & gap analysis (audit-proof): each question is answered (value +
verified citation), unverified (value, no proof), or a gap. Each open item is
routed web (publicly retrievable) or request (ask the client)."""
import json
import re

# (regex, field, channel, source) — first match wins. German + English.
RULES = [
    (r"\b(lei|legal entity identifier)\b", "lei", "web", "GLEIF (gleif.org)"),
    (r"(registration|register)\s*(no|number|nr)|handelsregister|hrb|hra|commercial register", "registration_number", "web", "Handels-/Unternehmensregister"),
    (r"(registered|business)\s*(office|address|seat)|(eingetragener\s*)?sitz|gesch[äa]ftsanschrift", "registered_office", "web", "Handels-/Unternehmensregister"),
    (r"(date|datum).*(incorporat|gr[üu]ndung|establish)|incorporation date|gr[üu]ndungsdatum", "incorporation_date", "web", "Handels-/Unternehmensregister"),
    (r"legal form|rechtsform|company type|gesellschaftsform", "legal_form", "web", "Handels-/Unternehmensregister"),
    (r"(managing director|director|gesch[äa]ftsf[üu]hrer|vorstand|board member|\borgan\b)", "directors", "web", "Handels-/Unternehmensregister"),
    (r"(listed|b[öo]rsennotiert|stock exchange|\b(isin|ticker)\b)", "listing", "web", "Börse / öffentliche Quelle"),
    (r"(industry|branche|\b(nace|sic)\b|sector|gesch[äa]ftst[äa]tigkeit|nature of business)", "industry", "web", "Register / Website"),
    (r"source of (wealth|funds)|mittelherkunft|verm[öo]gensherkunft|herkunft der (mittel|gelder)", "source_of_funds", "request", "Mandant (Erklärung + Nachweis)"),
    (r"\b(pep|politically exposed|politisch exponiert)\b", "pep", "request", "Mandant (Selbstauskunft)"),
    (r"(tax\s*(residence|identification)|tax\s+id\b|steuer(ans[äa]ssigkeit|nummer|id)|\b(tin|crs|fatca)\b)", "tax_residence", "request", "Mandant (+ Ansässigkeitsbescheinigung)"),
    (r"(passport|identity (card|document)|ausweis|reisepass|id copy|lichtbild)", "id_document", "request", "Mandant (beglaubigte Kopie)"),
    (r"(certified|beglaubigt|notari[sz]ed|apostille)", "certified_document", "request", "Mandant (Beglaubigung)"),
    (r"(bank reference|bankreferenz|bank statement|kontoauszug)", "bank_reference", "request", "Bank des Mandanten"),
    (r"(authoris|authoriz|signatory|unterschrift|zeichnungsberecht|vollmacht|power of attorney)", "signatory", "request", "Mandant (Vollmacht/Unterschrift)"),
    (r"(purpose|zweck).*(relationship|gesch[äa]ftsbeziehung|account|konto)|intended (nature|purpose)", "purpose_of_relationship", "request", "Mandant (Angabe)"),
    (r"(expected|anticipated).*(volume|turnover|transaction)|transaktionsvolumen", "expected_volume", "request", "Mandant (Angabe)"),
    (r"(date of birth|geburtsdatum|geburtsort|place of birth|nationalit|staatsangeh[öo]rigkeit)", "personal_details", "request", "Mandant (UBO-Angaben)"),
]


def classify_field(prompt: str) -> dict:
    for pat, field, channel, source in RULES:
        if re.search(pat, prompt, re.I):
            return {"fieldType": field, "channel": channel, "source": source}
    return {"fieldType": "other", "channel": "request", "source": "Mandant (zu klären)"}


def _has_verified_citation(citations_json: str) -> bool:
    try:
        cs = json.loads(citations_json or "[]")
        return any(c.get("verified") is not False and (c.get("quote") or "").strip() for c in cs)
    except Exception:
        return False


def build_coverage(questionnaire_id: str) -> dict:
    from ..db import db, rows
    with db() as con:
        qs = rows(con, "SELECT * FROM questions WHERE questionnaire_id=? ORDER BY position", (questionnaire_id,))
        ans = {a["question_id"]: a for a in rows(con, "SELECT a.* FROM answers a JOIN questions q ON q.id=a.question_id WHERE q.questionnaire_id=?", (questionnaire_id,))}
    items = []
    for q in qs:
        field = classify_field(q["prompt"])
        a = ans.get(q["id"])
        value = (a["value"].strip() if a and a["value"] else "")
        if value and a and _has_verified_citation(a["citations_json"]):
            status = "answered"
        elif value:
            status = "unverified"
        else:
            status = "gap"
        it = {"questionId": q["id"], "position": q["position"], "section": q["section"], "prompt": q["prompt"],
              "status": status, "value": value, "field": field}
        if status != "answered":
            it["gapKind"] = field["channel"]
            it["source"] = field["source"]
        items.append(it)
    answered = sum(1 for i in items if i["status"] == "answered")
    unver = sum(1 for i in items if i["status"] == "unverified")
    gap = sum(1 for i in items if i["status"] == "gap")
    openi = [i for i in items if i["status"] != "answered"]
    total = len(items)
    return {"questionnaireId": questionnaire_id, "total": total, "answered": answered, "unverified": unver, "gap": gap,
            "webGaps": sum(1 for i in openi if i.get("gapKind") == "web"),
            "requestGaps": sum(1 for i in openi if i.get("gapKind") == "request"),
            "coverage": (answered / total) if total else 0, "items": items}
