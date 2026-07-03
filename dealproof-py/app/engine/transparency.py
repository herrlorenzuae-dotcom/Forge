"""Transparenzregister / beneficial-ownership extract import.

Upload a Transparenzregister-Auszug (or any UBO extract). DealProof pulls out
the beneficial owners and:
  1. adds them to the project's structure (UBO person entities + edges to the
     subject company + UBO records), so they appear in the org chart, and
  2. folds the UBO list into the KYC Brain, so the recurring "who are the UBOs"
     questions answer themselves and YSolutions becomes a verification step.

Three extraction paths, in order:
  • an explicit one-line-per-UBO spec (deterministic, always works):
        UBO: Dr. Anna Vogt | 12.03.1975 | München, DE | 25-50% Kapital
        UBO: Maximilian Stein | 1979 | Zürich, CH | control (gesetzlicher Vertreter)
  • the model (if ANTHROPIC_API_KEY is set) for a free-text register extract
  • a heuristic parser for the common German Transparenzregister block layout
"""
import re
import json
from ..db import db, gen_id, one
from .. import config

PCT_BAND = re.compile(r"(\d{1,3})\s*%?\s*(?:bis|[-–]|to)\s*(?:einschließlich\s*)?(\d{1,3})\s*%", re.I)
PCT_ONE = re.compile(r"(\d{1,3}(?:[.,]\d+)?)\s*%")
CONTROL_HINT = re.compile(r"kontrolle|sonstige weise|gesetzlich(?:en)? vertret|control|managing director|gesch[äa]ftsf[üu]hr", re.I)


def _extent(text: str):
    """Map an 'Art und Umfang' phrase to (basis, pct, mechanism)."""
    t = (text or "").strip()
    band = PCT_BAND.search(t)
    if band:
        return "ownership", float(band.group(1)), ""        # lower bound of the band
    one_pct = PCT_ONE.search(t)
    if one_pct and not CONTROL_HINT.search(t):
        return "ownership", float(one_pct.group(1).replace(",", ".")), ""
    if CONTROL_HINT.search(t):
        mech = "Control (other means)"
        if re.search(r"gesetzlich|gesch[äa]ftsf[üu]hr|managing", t, re.I):
            mech = "Legal representative (fictitious UBO)"
        return "control", 0.0, mech
    return "ownership", 0.0, ""


def _spec_ubos(text: str):
    """Explicit 'UBO: name | birth | residence | extent' lines."""
    out = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line.lower().startswith("ubo:"):
            continue
        parts = [p.strip() for p in line.split(":", 1)[1].split("|")]
        name = parts[0]
        if not name:
            continue
        birth = parts[1] if len(parts) > 1 else ""
        residence = parts[2] if len(parts) > 2 else ""
        basis, pct, mech = _extent(parts[3] if len(parts) > 3 else "")
        out.append({"name": name, "birthdate": birth, "residence": residence,
                    "basis": basis, "pct": pct, "mechanism": mech, "extent": parts[3] if len(parts) > 3 else ""})
    return out


def _heuristic_ubos(text: str):
    """Parse the common German Transparenzregister block layout."""
    # split into per-owner blocks
    blocks = re.split(r"(?im)^\s*(?:wirtschaftlich\s+berechtigte?r?|nat[üu]rliche\s+person)\b.*$", text)
    out = []
    for b in blocks:
        first = _find(b, r"vorname")
        last = _find(b, r"nachname|name")
        full = _find(b, r"vor-?\s*und\s*nachname|vollst[äa]ndiger\s+name")
        name = full or " ".join(x for x in (first, last) if x).strip()
        if not name:
            continue
        birth = _find(b, r"geburtsdatum|geboren")
        residence = _find(b, r"wohnort|wohnsitzland|staat|land")
        extent = _find(b, r"art und umfang|umfang des wirtschaftlichen interesses|interesse")
        basis, pct, mech = _extent(extent)
        out.append({"name": name, "birthdate": birth, "residence": residence,
                    "basis": basis, "pct": pct, "mechanism": mech, "extent": extent})
    return out


def _find(block: str, label_pat: str):
    """First 'Label ...: value' line whose label starts with label_pat (extra
    words before the colon are allowed, e.g. 'Art und Umfang des ... :')."""
    for line in block.splitlines():
        m = re.match(rf"\s*(?:{label_pat})\b[^:]*:\s*(.+)$", line, re.I)
        if m:
            return m.group(1).strip()
    return ""


def _model_ubos(text: str):
    if not config.HAS_KEY:
        return []
    try:
        import anthropic
        sys = ("Extract the beneficial owners from this Transparenzregister / UBO extract as "
               "strict JSON: {\"ubos\":[{\"name\":str,\"birthdate\":str,\"residence\":str,"
               "\"basis\":\"ownership|control\",\"pct\":number,\"extent\":str}]}. Use 'control' "
               "(pct 0) for control by other means or a legal representative (fictitious UBO).")
        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
        resp = client.messages.create(model=config.MODEL, max_tokens=2000, system=sys,
                                       messages=[{"role": "user", "content": text[:16000]}])
        raw = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        a, z = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[a:z + 1])
        out = []
        for u in data.get("ubos", []):
            basis, pct, mech = _extent(u.get("extent", "") or ("control" if u.get("basis") == "control" else f"{u.get('pct', 0)}%"))
            out.append({"name": u.get("name", "").strip(), "birthdate": u.get("birthdate", ""),
                        "residence": u.get("residence", ""), "basis": u.get("basis", basis),
                        "pct": u.get("pct", pct) or pct, "mechanism": mech, "extent": u.get("extent", "")})
        return [u for u in out if u["name"]]
    except Exception:
        return []


# ── The official German Transparenzregister extract ──
# Layout: label line(s) followed by the value line, no colons. Labels can wrap
# ("Art des wirtschaftlichen / Interesses"). One block per beneficial owner.
_TR_BLOCK = re.compile(
    r"Name\s*\(Titel,\s*Nachname,\s*Vorname\)\s*(?P<name>.+?)\s*"
    r"Staatsangehörigkeit(?:\s+von)?\s*(?P<nat>.+?)\s*"
    r"Geburtsdatum\s*(?P<birth>[\d.]+)\s*"
    r"(?:Wohnort\s*(?P<city>.+?)\s*)?"
    r"(?:Wohnsitzland\s*(?P<country>.+?)\s*)?"
    r"Art des\s*wirtschaftlichen\s*Interesses\s*(?P<art>.+?)\s*"
    r"Umfang des\s*wirtschaftlichen\s*Interesses\s*(?P<umfang>.+?)(?=\s*Name\s*\(Titel|\s*Seite\s+\d|\s*Tag der Erstellung|$)",
    re.I | re.S)


def is_tr_extract(text: str) -> bool:
    t = text.lower()
    return "transparenzregister" in t and ("wirtschaftlich berechtigt" in t or "§ 19 gwg" in t)


def tr_company(text: str) -> str:
    """The legal entity the extract is about (line after the register header)."""
    m = re.search(r"Name der Rechtseinheit[^\n]*\n(.+)", text)
    if not m:
        return ""
    return m.group(1).split(",")[0].strip()


def _official_ubos(text: str):
    flat = re.sub(r"\s+", " ", text)
    out = []
    for m in _TR_BLOCK.finditer(flat):
        raw_name = m.group("name").strip()
        if "," in raw_name:                       # "Nachname, Vorname(n)" → flip
            last, first = raw_name.split(",", 1)
            name = f"{first.strip()} {last.strip()}"
        else:
            name = raw_name
        basis, pct, mech = _extent(f"{m.group('art')} {m.group('umfang')}")
        out.append({"name": name, "birthdate": m.group("birth"),
                    "residence": ", ".join(x for x in ((m.group("city") or "").strip(),
                                                       (m.group("country") or "").strip()) if x),
                    "basis": basis, "pct": pct, "mechanism": mech,
                    "extent": f"{m.group('art').strip()} — {m.group('umfang').strip()}"})
    return out


def ubo_answer_text(ubos: list) -> str:
    """One sentence naming the UBOs, for the Brain and reports."""
    parts = []
    for u in ubos:
        if u["basis"] == "control":
            tag = f"control — {u['mechanism']}" if u.get("mechanism") else "control"
        else:
            tag = (f"{int(u['pct'])}%" if u.get("pct") else "beneficial interest")
        parts.append(f"{u['name']} ({tag})")
    return "; ".join(parts) + " — per Transparenzregister."


def extract_ubos(text: str):
    """Pick the best extractor: the official register layout, an explicit spec,
    then the model, then the label:value heuristic."""
    official = _official_ubos(text)
    if official:
        return official
    spec = _spec_ubos(text)
    if spec:
        return spec
    return _model_ubos(text) or _heuristic_ubos(text)


def apply_ubos(project_id: str, ubos: list) -> dict:
    """Add the UBOs to the project structure (person entities + edges to the
    subject company + UBO records), without disturbing the existing structure."""
    if not ubos:
        return {"added": 0}
    from .projects import get_project
    proj = get_project(project_id)
    company = (proj or {}).get("subject_company", "").strip()
    with db() as con:
        ent = None
        if company:
            ent = one(con, "SELECT id FROM entities WHERE client_id=? AND lower(name)=lower(?)", (project_id, company))
        if not ent:
            ent = one(con, "SELECT id FROM entities WHERE client_id=? AND role='target' LIMIT 1", (project_id,))
        if not ent:
            cid = gen_id("ent")
            con.execute("INSERT INTO entities (id, client_id, name, kind, role, as_of) VALUES (?,?,?,?,?, date('now'))",
                        (cid, project_id, company or "Subject company", "holding", "target"))
            company_id = cid
        else:
            company_id = ent["id"]
        added = 0
        for u in ubos:
            uid = gen_id("ent")
            con.execute("INSERT INTO entities (id, client_id, name, kind, role, as_of) VALUES (?,?,?,?,?, date('now'))",
                        (uid, project_id, u["name"], "individual", "ubo"))
            kind = "control" if u["basis"] == "control" else "shares"
            con.execute("INSERT INTO ownership_edges (id, client_id, parent_id, child_id, pct, kind, mechanism, as_of) VALUES (?,?,?,?,?,?,?, date('now'))",
                        (gen_id("edge"), project_id, uid, company_id, u.get("pct", 0), kind, u.get("mechanism", "")))
            con.execute("INSERT INTO ubos (id, client_id, entity_id, basis, pct, pep, residence, as_of) VALUES (?,?,?,?,?,?,?, date('now'))",
                        (gen_id("ubo"), project_id, uid, u["basis"], u.get("pct", 0), 0, u.get("residence", "")))
            added += 1
    return {"added": added, "company_id": company_id}


def learn_ubos_into_brain(ubos: list, company: str = "") -> None:
    """Fold the UBO list into the Brain. With a company name the entry is
    COMPANY-SPECIFIC ('Beneficial owners of X') so different companies never
    contaminate each other; the generic prompts are only used without one
    (structure-page import, where the project provides the context)."""
    if not ubos:
        return
    from .brain import record_finalized_answer
    value = ubo_answer_text(ubos)
    if company:
        record_finalized_answer(f"Beneficial owners of {company}", value)
    else:
        for prompt in ("Identify all ultimate beneficial owners holding 25% or more.",
                       "Please provide details of the ultimate beneficial owners."):
            record_finalized_answer(prompt, value)


def import_extract(project_id: str, text: str) -> dict:
    """Full flow: extract UBOs, add to the structure, and learn them under the
    company they belong to (subject company, else the extract's own entity)."""
    from .projects import get_project
    ubos = extract_ubos(text)
    res = apply_ubos(project_id, ubos)
    company = ((get_project(project_id) or {}).get("subject_company") or "").strip() or tr_company(text)
    learn_ubos_into_brain(ubos, company=company)
    return {"ubos": ubos, **res}
