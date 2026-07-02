"""Entity profile — the master-data sheet ("Stammdatenblatt") per project.

The recurring substance of KYC requests is static master data about the subject
company/fund. This module defines that catalogue as structured fields, stores
values as entity_attributes on the subject entity (so the existing on-file
answering picks them up automatically), and can PULL provider-backed fields
from the connectors (Quantium / YSolutions / GLEIF) instead of typing them.

Field keys are chosen so the on-file needles in connectors/analysis match them.
"""
import json
import urllib.parse
import urllib.request

from .. import config
from ..db import db, rows, one, gen_id

# (id, key/label, group, hint, provider) — provider: where the value can be
# pulled from; None = manual entry (or the Brain, once learned).
FIELDS = [
    # 1 · Company master data
    ("legal_name", "Full legal name", "Company master data", "Exact name per the commercial register", "quantium"),
    ("legal_form", "Legal form", "Company master data", "GmbH, GmbH & Co. KG, S.à r.l., …", "quantium"),
    ("registration_number", "Registration number", "Company master data", "Court + number, e.g. Amtsgericht München, HRB 123456", "quantium"),
    ("incorporation_date", "Incorporation date", "Company master data", "", "quantium"),
    ("registered_office", "Registered address", "Company master data", "Registered office / principal business address", "quantium"),
    ("branches", "Foreign branches", "Company master data", "Branches covered by KYC responses, if any", None),
    ("lei", "LEI", "Company master data", "20-character Legal Entity Identifier", "gleif"),
    # 2 · Ownership & control
    ("ownership_type", "Type of ownership", "Ownership & control", "Privately owned / publicly traded / state owned / member owned", None),
    ("bearer_shares", "Bearer shares", "Ownership & control", "Issued now or ever? (usually 'No')", None),
    ("ultimate_parent", "Ultimate parent", "Ownership & control", "Topmost entity of the chain (see Structure)", None),
    # 3 · Beneficial owners
    ("beneficial_owners", "Beneficial owners", "Beneficial owners", "UBOs ≥25% capital or votes, or control by other means", "ysolutions"),
    ("ubo_details", "UBO personal details", "Beneficial owners", "Per UBO: date/place of birth, residence, nationality", None),
    # 4 · Management & representation
    ("directors", "Directors", "Management & representation", "Managing directors / board, with DOB and nationality", "quantium"),
    ("signatories", "Authorised signatories", "Management & representation", "Including powers of attorney", None),
    # 5 · Regulation & listing
    ("regulated", "Regulated status", "Regulation & listing", "Supervisory authority + licence, or 'not regulated'", None),
    ("listing", "Stock exchange listing", "Regulation & listing", "Exchange + ISIN/ticker, or 'not listed'", None),
    # 6 · Tax
    ("tax_residence", "Tax residence", "Tax", "Country of tax residence", None),
    ("tin", "Tax number / TIN", "Tax", "", None),
    ("fatca_crs", "FATCA/CRS classification", "Tax", "e.g. Passive NFE; W-8BEN-E on file", None),
    ("giin", "GIIN", "Tax", "If registered with the IRS", None),
    # 7 · Fund-specific
    ("fund_type", "Fund type", "Fund-specific", "e.g. closed-ended private equity fund", None),
    ("fund_strategy", "Fund strategy", "Fund-specific", "Investment strategy in 2–3 sentences", None),
    ("aum", "Assets under management", "Fund-specific", "", None),
    ("investor_type", "Investor types", "Fund-specific", "Institutional / HNWI; minimum subscription", None),
    ("mgmt_company", "Management company", "Fund-specific", "Name + register + regulation", None),
    # 8 · AML / compliance
    ("pep_status", "PEP status", "AML / compliance", "Screening result for the UBOs", None),
    ("sanctions_status", "Sanctions screening", "AML / compliance", "Result + date", None),
    ("source_of_funds", "Source of funds", "AML / compliance", "", None),
    ("purpose", "Purpose of relationship", "AML / compliance", "", None),
    ("shell_banks", "Shell bank confirmation", "AML / compliance", "Standard: no relationships with shell banks", None),
]
GROUP_ORDER = ["Company master data", "Ownership & control", "Beneficial owners",
               "Management & representation", "Regulation & listing", "Tax",
               "Fund-specific", "AML / compliance"]
PROVIDER_LABEL = {"quantium": "Quantium", "ysolutions": "YSolutions", "gleif": "GLEIF", None: "Manual / Brain"}


def subject_entity(project_id: str) -> str:
    """The entity this KYC is about — by the project's subject company name,
    else the structure's target, else created from the project fields."""
    from .projects import get_project
    proj = get_project(project_id) or {}
    company = (proj.get("subject_company") or "").strip()
    with db() as con:
        ent = None
        if company:
            ent = one(con, "SELECT id FROM entities WHERE client_id=? AND lower(name)=lower(?)", (project_id, company))
        if not ent:
            ent = one(con, "SELECT id FROM entities WHERE client_id=? AND role='target' LIMIT 1", (project_id,))
        if ent:
            return ent["id"]
        eid = gen_id("ent")
        con.execute("INSERT INTO entities (id, client_id, name, kind, role, as_of) VALUES (?,?,?,?,?, date('now'))",
                    (eid, project_id, company or proj.get("name", "Subject company"), "holding", "target"))
        return eid


def get_profile(project_id: str) -> dict:
    """Grouped field list with stored values/sources."""
    eid = subject_entity(project_id)
    with db() as con:
        attrs = {a["key"]: a for a in rows(con, "SELECT * FROM entity_attributes WHERE entity_id=?", (eid,))}
    groups = {g: [] for g in GROUP_ORDER}
    filled = 0
    for fid, key, group, hint, provider in FIELDS:
        a = attrs.get(key)
        if a and (a["value"] or "").strip():
            filled += 1
        groups[group].append({"id": fid, "key": key, "hint": hint, "provider": provider,
                              "provider_label": PROVIDER_LABEL[provider],
                              "value": (a["value"] if a else "") or "",
                              "source": (a["source"] if a else "") or "",
                              "as_of": (a["as_of"] if a else "") or ""})
    return {"entity_id": eid, "groups": [(g, groups[g]) for g in GROUP_ORDER],
            "filled": filled, "total": len(FIELDS)}


def save_profile(project_id: str, values: dict) -> int:
    """Upsert manual values (field id -> value). Empty value clears the field."""
    eid = subject_entity(project_id)
    keys = {fid: key for fid, key, *_ in FIELDS}
    saved = 0
    with db() as con:
        for fid, val in values.items():
            key = keys.get(fid)
            if not key:
                continue
            val = (val or "").strip()
            existing = one(con, "SELECT id, value, source FROM entity_attributes WHERE entity_id=? AND key=?", (eid, key))
            if existing and existing["value"] == val:
                continue
            if existing:
                con.execute("DELETE FROM entity_attributes WHERE id=?", (existing["id"],))
            if val:
                con.execute("INSERT INTO entity_attributes (id, entity_id, key, value, source, as_of) VALUES (?,?,?,?,?, date('now'))",
                            (gen_id("attr"), eid, key, val, "manual", ))
                saved += 1
    return saved


def _gleif_lookup(name: str):
    """Public GLEIF API — the one lookup that needs no vendor contract."""
    if not name:
        return None
    url = ("https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]="
           + urllib.parse.quote(name) + "&page[size]=1")
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/vnd.api+json"})
        with urllib.request.urlopen(req, timeout=config.CONNECTOR_TIMEOUT) as r:
            data = json.loads(r.read().decode("utf-8"))
        rec = (data.get("data") or [None])[0]
        if not rec:
            return None
        lei = rec.get("id", "")
        status = rec.get("attributes", {}).get("registration", {}).get("status", "")
        return f"{lei} (GLEIF — status: {status})" if lei else None
    except Exception:
        return None


def pull_profile(project_id: str) -> dict:
    """Fill EMPTY provider-backed fields from the sources: GLEIF live, Quantium /
    YSolutions live when configured (else labelled mock). Stored values are
    never overwritten. Returns {pulled, tried}."""
    from . import connectors
    from .projects import get_project
    eid = subject_entity(project_id)
    proj = get_project(project_id) or {}
    company = (proj.get("subject_company") or "").strip()
    with db() as con:
        attrs = {a["key"]: (a["value"] or "").strip() for a in rows(con, "SELECT key, value FROM entity_attributes WHERE entity_id=?", (eid,))}
    pulled, tried = 0, 0

    def store(key, value, source):
        nonlocal pulled
        with db() as con:
            con.execute("DELETE FROM entity_attributes WHERE entity_id=? AND key=?", (eid, key))
            con.execute("INSERT INTO entity_attributes (id, entity_id, key, value, source, as_of) VALUES (?,?,?,?,?, date('now'))",
                        (gen_id("attr"), eid, key, value, source))
        pulled += 1

    # profile field id -> the connectors' field_type
    CONNECTOR_FT = {"beneficial_owners": "beneficial_owner"}
    for fid, key, group, hint, provider in FIELDS:
        if not provider or attrs.get(key):
            continue
        tried += 1
        if fid == "legal_name" and company:
            store(key, company, "Project")
            continue
        if provider == "gleif":
            val = _gleif_lookup(company)
            if val:
                store(key, val, "GLEIF")
            elif config.MOCK_CONNECTORS and fid in connectors.MOCK:
                store(key, connectors.MOCK[fid], "Mock GLEIF")
            continue
        if provider == "ysolutions":
            # beneficial owners: prefer the project's own UBO records
            with db() as con:
                ubos = rows(con, "SELECT u.pct, u.basis, e.name FROM ubos u JOIN entities e ON e.id=u.entity_id WHERE u.client_id=?", (project_id,))
            if ubos:
                txt = "; ".join(f"{u['name']} ({int(u['pct'])}%+)" if u["pct"] else f"{u['name']} (control)" for u in ubos)
                store(key, txt, "Structure / Transparenzregister")
                continue
        res = connectors._provider_answer(project_id, CONNECTOR_FT.get(fid, fid), provider)
        if res and res.get("value"):
            store(key, res["value"], res["source_label"] + (" (mock)" if "Mock" in res.get("detail", "") else ""))
    return {"pulled": pulled, "tried": tried}
