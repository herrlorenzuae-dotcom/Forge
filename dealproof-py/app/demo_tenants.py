"""Tenant-specific seed data — REAL client values.

PRIVATE REPOSITORY ONLY. This module contains actual client data (taken from
documents the client provided: Transparenzregister extract LNXRCC and the
group structure chart Stand Oktober 2024). It seeds ONLY inside the matching
tenant's own data store; other tenants never see it. Delete this file to
remove the seed.
"""
from .db import db, one, gen_id


def seed_for_tenant(slug: str) -> bool:
    """Seed real-client data for the tenant. Returns True when this tenant has
    its own seed — its data store then stays free of the fictional demo."""
    if slug == "armira":
        _seed_armira()
        return True
    return False


ARMIRA_ID = "proj_armira_iii"
LEGACY_IDS = ("proj_armira_beteiligungen",)

# Subject: the deal fund. Deliberately NOT the KVG — Armira Beteiligungen
# GmbH & Co. KG is a licensed Kapitalverwaltungsgesellschaft under BaFin
# supervision and therefore a poor mock-up subject.
ARMIRA_COMPANY = "Armira III GmbH & Co. geschlossene Investment KG"
ARMIRA_KVG = "Armira Beteiligungen GmbH & Co. KG"

# Strand from the group structure chart (Stand Oktober 2024): control runs
# through the general-partner chain down to the fund; the fund's capital sits
# dispersed with feeder vehicles and investors (no natural person > 25%).
ARMIRA_SPEC = f"""\
Alexander Paul Schemann -> Armira Verwaltungs GmbH : 100%
Armira Verwaltungs GmbH -> Armira GmbH & Co. KG : control (General partner / Komplementär)
Armira GmbH & Co. KG -> {ARMIRA_KVG} : 100%
Armira GmbH & Co. KG -> Armira Beteiligungen Verwaltungs GmbH : 100%
Armira Beteiligungen Verwaltungs GmbH -> {ARMIRA_KVG} : control (General partner / Komplementär)
{ARMIRA_KVG} -> Armira III GP GmbH : 100%
Armira III GP GmbH -> {ARMIRA_COMPANY} : control (General partner / Komplementär)
Armira III Team GmbH & Co. KG -> {ARMIRA_COMPANY} : shares
Armira III F&F GmbH & Co. geschlossene Investment KG -> {ARMIRA_COMPANY} : shares
Armira III Initiators GmbH & Co. KG -> {ARMIRA_COMPANY} : shares
Armira III Pool GmbH & Co. geschlossene Investment KG -> {ARMIRA_COMPANY} : shares
Armira III US Pool GmbH & Co. geschlossene Investment KG -> {ARMIRA_COMPANY} : shares
Titanbay Armira III IP S.à r.l. -> {ARMIRA_COMPANY} : shares
Weitere Investoren -> {ARMIRA_COMPANY} : shares
TARGET: {ARMIRA_COMPANY}
UBO: Alexander Paul Schemann
"""

# Reportable beneficial owner of the fund: no natural person holds > 25% of
# the capital (dispersed investors), but control runs over the GP chain —
# Armira III GP GmbH is 100% held by the KVG, which sits under Alexander Paul
# Schemann's chain (per structure chart; person data per TR extract LNXRCC).
ARMIRA_TR = {
    "art": "Ausübung von Kontrolle auf sonstige Weise",
    "umfang": "",
    "ubo_name": "Alexander Paul Schemann",
    "birth": "20.02.1977",
    "residence": "München, Deutschland",
    "ref": "Strukturchart Stand Oktober 2024 (Komplementärs-Kette über Armira III GP GmbH); Person: TR-Auszug LNXRCC",
}

# Facts on file for the subject (structure chart + client information)
ARMIRA_ATTRS = [
    ("Full legal name", ARMIRA_COMPANY, "Strukturchart Stand Oktober 2024"),
    ("Legal form", "GmbH & Co. geschlossene Investment KG (geschlossener AIF)", "Strukturchart Stand Oktober 2024"),
    ("General partner", "Armira III GP GmbH", "Strukturchart Stand Oktober 2024"),
    ("Manager (KVG)", f"{ARMIRA_KVG} — erlaubnispflichtige Kapitalverwaltungsgesellschaft, BaFin-Aufsicht", "Client"),
]

# Facts on file for the KVG (TR extract LNXRCC + client information)
KVG_ATTRS = [
    ("Regulatory status", "Erlaubnispflichtige Kapitalverwaltungsgesellschaft (KVG) unter Aufsicht der BaFin", "Client"),
    ("Registration number", "Amtsgericht München HRA 102192", "Transparenzregister-Auszug LNXRCC"),
    ("EKRN (Transparenzregister)", "DE527302009701", "Transparenzregister-Auszug LNXRCC"),
]


def _seed_armira() -> None:
    from .engine import spa, projects, brain
    from .engine.ubolaw import classify_extent
    from .engine.transparency import ubo_answer_text
    from .demo import _demo_word, QUESTIONNAIRE

    for legacy in LEGACY_IDS:
        with db() as con:
            old = one(con, "SELECT 1 FROM clients WHERE id=?", (legacy,))
        if old:
            projects.delete_project(legacy)

    with db() as con:
        existing = one(con, "SELECT 1 FROM clients WHERE id=?", (ARMIRA_ID,))
        # up to date = UBO note present AND the GP-owner edge from the chart is in
        current = existing and one(con, "SELECT 1 FROM ubos WHERE client_id=? AND note!='' LIMIT 1", (ARMIRA_ID,)) and one(con, """
            SELECT 1 FROM ownership_edges e
            JOIN entities p ON p.id=e.parent_id JOIN entities c ON c.id=e.child_id
            WHERE e.client_id=? AND p.name='Armira GmbH & Co. KG'
              AND c.name='Armira Beteiligungen Verwaltungs GmbH'""", (ARMIRA_ID,))
    if existing and current:
        return
    if existing:
        projects.delete_project(ARMIRA_ID)

    with db() as con:
        con.execute("""INSERT INTO clients (id, name, subject_company, register_no, portfolio_company, status, updated_at)
                       VALUES (?,?,?,?,?, 'open', datetime('now'))""",
                    (ARMIRA_ID, f"{ARMIRA_COMPANY} — KYC master file", ARMIRA_COMPANY, "", ""))

    spa.apply_structure(ARMIRA_ID, spa.parse_structure_spec(ARMIRA_SPEC))

    c = classify_extent(ARMIRA_TR["art"], ARMIRA_TR["umfang"])
    note = f"{c['note']} — {ARMIRA_TR['ref']}, geb. {ARMIRA_TR['birth']}"
    with db() as con:
        ubo_ent = one(con, "SELECT id FROM entities WHERE client_id=? AND name=?", (ARMIRA_ID, ARMIRA_TR["ubo_name"]))
        if ubo_ent:
            con.execute("UPDATE ubos SET basis=?, pct=?, note=?, residence=? WHERE client_id=? AND entity_id=?",
                        (c["basis"], c["pct"], note, ARMIRA_TR["residence"], ARMIRA_ID, ubo_ent["id"]))
        for ent_name, attrs in ((ARMIRA_COMPANY, ARMIRA_ATTRS), (ARMIRA_KVG, KVG_ATTRS)):
            row = one(con, "SELECT id FROM entities WHERE client_id=? AND name=?", (ARMIRA_ID, ent_name))
            if row:
                for key, value, src in attrs:
                    con.execute("INSERT INTO entity_attributes (id, entity_id, key, value, source, as_of) VALUES (?,?,?,?,?, date('now'))",
                                (gen_id("attr"), row["id"], key, value, src))

    # firm memory, exactly as register imports / client input would teach it
    u = {"name": ARMIRA_TR["ubo_name"], "basis": c["basis"], "pct": c["pct"],
         "short": c["short"], "ref": c["ref"]}
    brain.record_finalized_answer(f"Beneficial owners of {ARMIRA_COMPANY}", ubo_answer_text([u]))
    brain.record_finalized_answer(
        "Is the contracting entity a regulated financial institution?",
        f"The entity itself is a closed-ended investment KG (AIF). Its manager, {ARMIRA_KVG}, "
        "is a licensed Kapitalverwaltungsgesellschaft (KVG) supervised by BaFin.")
    brain.record_finalized_answer(
        f"Is {ARMIRA_KVG} a regulated financial institution?",
        "Yes — erlaubnispflichtige Kapitalverwaltungsgesellschaft (KVG) unter Aufsicht der BaFin.")

    # a standard bank questionnaire so the Answers step demonstrates the flow
    projects.add_document(ARMIRA_ID, "Bank-onboarding-KYC.docx", QUESTIONNAIRE,
                          "Bank", content=_demo_word(QUESTIONNAIRE))
