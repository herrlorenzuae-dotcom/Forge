"""Tenant-specific seed data — REAL client values.

PRIVATE REPOSITORY ONLY. This module contains actual client data (taken from
documents the client provided: Transparenzregister extract LNXRCC and the
group structure chart). It seeds ONLY inside the matching tenant's own data
store; other tenants never see it. Delete this file to remove the seed.
"""
from .db import db, one, gen_id


def seed_for_tenant(slug: str) -> None:
    if slug == "armira":
        _seed_armira()


ARMIRA_ID = "proj_armira_beteiligungen"
ARMIRA_COMPANY = "Armira Beteiligungen GmbH & Co. KG"

# Verified strand from the group structure chart (Stand Oktober 2024) —
# the chain a bank needs to follow from the UBO down to the subject company.
ARMIRA_SPEC = f"""\
Alexander Paul Schemann -> Armira Verwaltungs GmbH : 100%
Armira Verwaltungs GmbH -> Armira GmbH & Co. KG : control (General partner / Komplementär)
Armira GmbH & Co. KG -> {ARMIRA_COMPANY} : 100%
Armira Beteiligungen Verwaltungs GmbH -> {ARMIRA_COMPANY} : control (General partner / Komplementär)
TARGET: {ARMIRA_COMPANY}
UBO: Alexander Paul Schemann
"""

# From the Transparenzregister extract (Referenz LNXRCC, gültig ab 30.06.2023)
ARMIRA_TR = {
    "art": "Beteiligung an der Vereinigung selbst, insbesondere der Höhe der Kapitalanteile (§ 19 Abs. 3 Nr. 1a GwG)",
    "umfang": "100 %",
    "ubo_name": "Alexander Paul Schemann",
    "birth": "20.02.1977",
    "residence": "München, Deutschland",
    "ref": "TR-Auszug LNXRCC, gültig ab 30.06.2023",
}

# Facts held on file for the subject company (register data from the extract)
ARMIRA_ATTRS = [
    ("Full legal name", ARMIRA_COMPANY, "Transparenzregister-Auszug"),
    ("Legal form", "GmbH & Co. KG", "Handelsregister"),
    ("Registration number", "Amtsgericht München HRA 102192", "Transparenzregister-Auszug"),
    ("Registered address", "München, Deutschland", "Transparenzregister-Auszug (Sitz)"),
    ("EKRN (Transparenzregister)", "DE527302009701", "Transparenzregister-Auszug"),
]


def _seed_armira() -> None:
    from .engine import spa, projects, brain
    from .engine.ubolaw import classify_extent
    from .engine.transparency import ubo_answer_text
    from .demo import _demo_word, QUESTIONNAIRE

    with db() as con:
        existing = one(con, "SELECT 1 FROM clients WHERE id=?", (ARMIRA_ID,))
        current = one(con, "SELECT 1 FROM ubos WHERE client_id=? AND note!='' LIMIT 1", (ARMIRA_ID,)) if existing else None
    if existing and current:
        return
    if existing:
        projects.delete_project(ARMIRA_ID)

    with db() as con:
        con.execute("""INSERT INTO clients (id, name, subject_company, register_no, portfolio_company, status, updated_at)
                       VALUES (?,?,?,?,?, 'open', datetime('now'))""",
                    (ARMIRA_ID, f"{ARMIRA_COMPANY} — KYC master file",
                     ARMIRA_COMPANY, "Amtsgericht München HRA 102192", ""))

    spa.apply_structure(ARMIRA_ID, spa.parse_structure_spec(ARMIRA_SPEC))

    c = classify_extent(ARMIRA_TR["art"], ARMIRA_TR["umfang"])
    note = f"{c['note']} — {ARMIRA_TR['ref']}, geb. {ARMIRA_TR['birth']}"
    with db() as con:
        ubo_ent = one(con, "SELECT id FROM entities WHERE client_id=? AND name=?", (ARMIRA_ID, ARMIRA_TR["ubo_name"]))
        if ubo_ent:
            con.execute("UPDATE ubos SET basis=?, pct=?, note=?, residence=? WHERE client_id=? AND entity_id=?",
                        (c["basis"], c["pct"], note, ARMIRA_TR["residence"], ARMIRA_ID, ubo_ent["id"]))
        subj = one(con, "SELECT id FROM entities WHERE client_id=? AND name=?", (ARMIRA_ID, ARMIRA_COMPANY))
        if subj:
            for key, value, src in ARMIRA_ATTRS:
                con.execute("INSERT INTO entity_attributes (id, entity_id, key, value, source, as_of) VALUES (?,?,?,?,?, date('now'))",
                            (gen_id("attr"), subj["id"], key, value, src))

    # company-specific Brain entry, exactly as a register import would learn it
    u = {"name": ARMIRA_TR["ubo_name"], "basis": c["basis"], "pct": c["pct"],
         "short": c["short"], "ref": c["ref"]}
    brain.record_finalized_answer(f"Beneficial owners of {ARMIRA_COMPANY}", ubo_answer_text([u]))

    # a standard bank questionnaire so the Answers step demonstrates the flow
    projects.add_document(ARMIRA_ID, "Bank-onboarding-KYC.docx", QUESTIONNAIRE,
                          "Bank", content=_demo_word(QUESTIONNAIRE))
