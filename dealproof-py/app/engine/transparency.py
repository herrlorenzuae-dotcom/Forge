"""Transparenzregister / beneficial-ownership extract import.

What an extract IS: the legal statement of WHO the beneficial owners are and
WHY (Art & Umfang des wirtschaftlichen Interesses, with its § reference). What
it is NOT: the ownership chain — that comes from the structure chart / SPA.

So the import:
  1. extracts the UBOs incl. the verbatim legal basis (mapped onto the GwG
     catalogue in ubolaw.py),
  2. MATCHES each UBO against the existing structure — a matched person is
     annotated (role, basis, § note), NO edge is invented,
  3. only if the person is not in the chart yet, a grey ATTRIBUTION link
     ("per Transparenzregister") connects them to the subject company, clearly
     distinct from ownership/control strands, and
  4. folds the UBO statement into the KYC Brain under the company it belongs to.

Extraction paths, in order: the OFFICIAL register layout (label lines above
value lines, N owners per block), an explicit one-line spec, the model (if a
key is set), then a label:value heuristic."""
import re
import json
from ..db import db, gen_id, one, rows
from .. import config
from .ubolaw import classify_extent

PCT_RE = re.compile(r"(\d{1,3}(?:[.,]\d+)?)\s*%")
DATE_RE = re.compile(r"^\d{1,2}\.\d{1,2}\.\d{4}$")


def _mk_ubo(name, birth="", residence="", art="", umfang=""):
    c = classify_extent(art, umfang)
    return {"name": name.strip(), "birthdate": birth.strip(), "residence": residence.strip(),
            "basis": c["basis"], "pct": c["pct"],
            "mechanism": c["short"] if c["basis"] == "control" else "",
            "extent": c["verbatim"], "short": c["short"], "ref": c["ref"],
            "explain": c["explain"], "note": c["note"], "code": c["code"]}


def is_tr_extract(text: str) -> bool:
    """The OFFICIAL register extract — not just any document that mentions the
    register (a blank UBO questionnaire does too)."""
    t = text.lower()
    return ("auszug aus dem transparenzregister" in t
            or ("transparenzregister" in t and "angaben zu wirtschaftlich berechtigten" in t))


def tr_company(text: str) -> str:
    """The legal entity the extract is about (line after the register header)."""
    m = re.search(r"Name der Rechtseinheit[^\n]*\n(.+)", text)
    if not m:
        return ""
    return m.group(1).split(",")[0].strip()


# ── The official German Transparenzregister extract ──
# Layout: label line(s) above the value line(s), no colons; several owners are
# listed as stacked value lines under EACH label ("columnar").
_LABELS = [
    ("name", re.compile(r"^Name\s*\(Titel", re.I)),
    ("nat", re.compile(r"^Staatsangehörigkeit", re.I)),
    ("birth", re.compile(r"^Geburtsdatum", re.I)),
    ("city", re.compile(r"^Wohnort\b", re.I)),
    ("country", re.compile(r"^Wohnsitzland", re.I)),
    ("art", re.compile(r"^Art des\b", re.I)),
    ("umfang", re.compile(r"^Umfang des\b", re.I)),
]
_CONTINUATION = re.compile(r"^(Vorname\)|Interesses|wirtschaftlichen\s+Interesses|von)$", re.I)
_STOP = re.compile(r"^(Seite\s+\d|Tag der Erstellung|EKRN:|Referenznummer)", re.I)
_GRUND = re.compile(r"^Grund für die Angabe", re.I)


def _official_ubos(text: str):
    lines = [l.strip() for l in text.splitlines()]
    groups, cur, label, grund = [], None, None, ""
    for ln in lines:
        if not ln:
            continue
        hit = next((k for k, pat in _LABELS if pat.match(ln)), None)
        if hit == "name":
            cur = {k: [] for k, _ in _LABELS}
            groups.append(cur)
            label = "name"
            continue
        if hit:
            label = hit if cur is not None else None
            continue
        if _CONTINUATION.match(ln):
            continue
        if _GRUND.match(ln):
            grund = ln
            label = "grund"
            continue
        if _STOP.match(ln):
            label = None
            continue
        if cur is not None and label and label != "grund":
            cur[label].append(ln)

    out = []
    for g in groups:
        names = [n for n in g["name"] if "," in n or re.match(r"^[A-ZÄÖÜ]\S+\s+\S+", n)]
        if not names:
            continue
        n = len(names)
        births = [b for b in g["birth"] if DATE_RE.match(b)]
        cities, countries = g["city"], g["country"]
        # Art blocks: one per owner, each ending with its § reference
        art_join = " ".join(g["art"])
        arts = [a.strip() for a in re.split(r"(?<=GwG\))", art_join) if a.strip()]
        if len(arts) != n:
            arts = [art_join] * n if art_join else [""] * n
        umfs = [u for u in g["umfang"] if PCT_RE.search(u)]
        for i, raw_name in enumerate(names):
            if "," in raw_name:
                last, first = raw_name.split(",", 1)
                name = f"{first.strip()} {last.strip()}"
            else:
                name = raw_name
            residence = ", ".join(x for x in (
                cities[i] if i < len(cities) else "",
                countries[i] if i < len(countries) else "") if x)
            u = _mk_ubo(name, births[i] if i < len(births) else "", residence,
                        arts[i], umfs[i] if i < len(umfs) else "")
            if grund and "keine angabe" not in grund.lower():
                u["note"] += f" — {grund}"
            out.append(u)
    return out


# ── Explicit one-line spec ──
def _spec_ubos(text: str):
    out = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line.lower().startswith("ubo:"):
            continue
        parts = [p.strip() for p in line.split(":", 1)[1].split("|")]
        if not parts[0]:
            continue
        out.append(_mk_ubo(parts[0], parts[1] if len(parts) > 1 else "",
                           parts[2] if len(parts) > 2 else "",
                           parts[3] if len(parts) > 3 else ""))
    return out


# ── label:value heuristic (free-form extracts) ──
def _find(block: str, label_pat: str):
    for line in block.splitlines():
        m = re.match(rf"\s*(?:{label_pat})\b[^:]*:\s*(.+)$", line, re.I)
        if m:
            return m.group(1).strip()
    return ""


def _heuristic_ubos(text: str):
    blocks = re.split(r"(?im)^\s*(?:wirtschaftlich\s+berechtigte?r?|nat[üu]rliche\s+person)\b.*$", text)
    out = []
    for b in blocks:
        first = _find(b, r"vorname")
        last = _find(b, r"nachname|name")
        full = _find(b, r"vor-?\s*und\s*nachname|vollst[äa]ndiger\s+name")
        name = full or " ".join(x for x in (first, last) if x).strip()
        if not name:
            continue
        out.append(_mk_ubo(name, _find(b, r"geburtsdatum|geboren"),
                           _find(b, r"wohnort|wohnsitzland|staat|land"),
                           _find(b, r"art und umfang|umfang des wirtschaftlichen interesses|interesse")))
    return out


def _model_ubos(text: str):
    if not config.HAS_KEY:
        return []
    try:
        import anthropic
        sys = ("Extract the beneficial owners from this Transparenzregister / UBO extract as "
               "strict JSON: {\"ubos\":[{\"name\":str,\"birthdate\":str,\"residence\":str,"
               "\"extent\":str}]}. 'extent' is the verbatim Art/Umfang des wirtschaftlichen "
               "Interesses wording including the § reference.")
        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
        resp = client.messages.create(model=config.MODEL, max_tokens=2000, system=sys,
                                       messages=[{"role": "user", "content": text[:16000]}])
        raw = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        a, z = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[a:z + 1])
        return [_mk_ubo(u.get("name", ""), u.get("birthdate", ""), u.get("residence", ""),
                        u.get("extent", "")) for u in data.get("ubos", []) if u.get("name")]
    except Exception:
        return []


def extract_ubos(text: str):
    """Pick the best extractor: official layout, explicit spec, model, heuristic."""
    return _official_ubos(text) or _spec_ubos(text) or _model_ubos(text) or _heuristic_ubos(text)


def ubo_answer_text(ubos: list) -> str:
    """Bank-ready sentence: who is UBO and WHY, with the § reference."""
    parts = []
    for u in ubos:
        if u.get("basis") != "control" and u.get("pct"):
            pct = str(int(u["pct"])) if float(u["pct"]).is_integer() else str(u["pct"])
            why = f"{pct} % Kapitalanteile — {u.get('ref', '§ 3 Abs. 2 GwG')}"
        else:
            why = f"{u.get('short', 'control')} — {u.get('ref', '§ 3 Abs. 2 GwG')}"
        parts.append(f"{u['name']} ({why})")
    return "; ".join(parts) + " — per Transparenzregister."


def _norm_person(name: str) -> str:
    n = re.sub(r"\b(dr|prof|med|dipl|ing)\.?\b", " ", name.lower())
    return re.sub(r"[^a-zäöüß ]+", " ", n).strip()


def _match_entity(entities, person: str):
    """Find the person in the existing structure: exact normalized name, else
    token containment in either direction (the chart may say 'Alexander
    Schemann' while the register says 'Alexander Paul Schemann')."""
    p = _norm_person(person)
    toks = set(p.split())
    for e in entities:
        if _norm_person(e["name"]) == p:
            return e
    for e in entities:
        if e["kind"] != "individual":
            continue
        et = set(_norm_person(e["name"]).split())
        if not toks or not et:
            continue
        if toks <= et or (et <= toks and len(et) >= 2):
            return e
    return None


def apply_ubos(project_id: str, ubos: list) -> dict:
    """Annotate the structure with the register's UBO statements. A person who
    already exists in the chart is marked as UBO (basis + § note) — no edge is
    invented. Only an unknown person is added, linked by a grey ATTRIBUTION
    edge ('per Transparenzregister') so the chart shows the statement without
    faking an ownership strand."""
    if not ubos:
        return {"matched": 0, "added": 0}
    from .structure import get_structure
    from .profile import subject_entity
    s = get_structure(project_id)
    company_id = subject_entity(project_id)

    def _director_of(person):
        """Entity whose 'Directors' attribute names this person — for fictitious
        UBOs (§ 3 Abs. 2 S. 5 GwG) the traceable anchor is the entity they
        legally represent (usually the general partner)."""
        p = set(_norm_person(person).split())
        for a in s["attributes"]:
            if a["key"].lower() != "directors":
                continue
            for d in re.split(r";|,", a["value"]):
                dt = set(_norm_person(d).split())
                if dt and (dt <= p or p <= dt):
                    return a["entity_id"]
        return None

    matched = added = 0
    with db() as con:
        for u in ubos:
            ent = _match_entity(s["entities"], u["name"])
            if ent:
                eid = ent["id"]
                con.execute("UPDATE entities SET role='ubo' WHERE id=? AND role IN ('other','')", (eid,))
                matched += 1
            else:
                eid = gen_id("ent")
                con.execute("INSERT INTO entities (id, client_id, name, kind, role, as_of) VALUES (?,?,?,?,?, date('now'))",
                            (eid, project_id, u["name"], "individual", "ubo"))
                anchor = (_director_of(u["name"]) if u.get("code") == "fictitious" else None) or company_id
                mech = ("gesetzlicher Vertreter (§ 3 Abs. 2 S. 5 GwG)"
                        if u.get("code") == "fictitious" and anchor != company_id
                        else "per Transparenzregister")
                if eid != anchor:
                    con.execute("INSERT INTO ownership_edges (id, client_id, parent_id, child_id, pct, kind, mechanism, as_of) VALUES (?,?,?,?,?,?,?, date('now'))",
                                (gen_id("edge"), project_id, eid, anchor, 0, "attribution", mech))
                added += 1
            con.execute("DELETE FROM ubos WHERE client_id=? AND entity_id=?", (project_id, eid))
            con.execute("INSERT INTO ubos (id, client_id, entity_id, basis, pct, pep, residence, note, as_of) VALUES (?,?,?,?,?,?,?,?, date('now'))",
                        (gen_id("ubo"), project_id, eid, u["basis"], u.get("pct", 0), 0,
                         u.get("residence", ""), u.get("note", "")))
    return {"matched": matched, "added": added, "company_id": company_id}


def learn_ubos_into_brain(ubos: list, company: str = "") -> None:
    """Fold the UBO statement into the Brain. With a company name the entry is
    COMPANY-SPECIFIC ('Beneficial owners of X') so different companies never
    contaminate each other; the generic prompts are only used without one."""
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
    """Full flow: extract UBOs, annotate the structure, and learn them under
    the company they belong to (subject company, else the extract's entity)."""
    from .projects import get_project
    ubos = extract_ubos(text)
    res = apply_ubos(project_id, ubos)
    company = ((get_project(project_id) or {}).get("subject_company") or "").strip() or tr_company(text)
    learn_ubos_into_brain(ubos, company=company)
    return {"ubos": ubos, **res}
