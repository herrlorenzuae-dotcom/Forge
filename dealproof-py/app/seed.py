"""Demo seed — Project Halcyon: a Luxembourg BidCo acquiring Meridian Logistics
Park, owned up through a German topco to Dr. Katharina Brandt, plus a couple of
historical answers folded into the KYC Brain and a fresh questionnaire."""
from .db import db, gen_id, one
from .engine.intake import create_questionnaire
from .engine.brain import record_finalized_answer

CLIENT = "client-halcyon"

ENTITIES = [
    ("Dr. Katharina Brandt", "individual", "ubo", "DE"),
    ("Lars Andersson", "individual", "other", "SE"),
    ("Brandt Familienholding GmbH", "holding", "topco", "DE"),
    ("Halcyon Beteiligungs GmbH", "holding", "intermediate", "DE"),
    ("Halcyon Holding S.à r.l.", "holding", "intermediate", "LU"),
    ("Halcyon BidCo S.à r.l.", "spv", "acquisition_vehicle", "LU"),
    ("Meridian Logistics Park S.A.", "operating", "target", "LU"),
]
EDGES = [  # parent, child, pct, kind, mechanism
    ("Dr. Katharina Brandt", "Brandt Familienholding GmbH", 100, "shares", ""),
    ("Dr. Katharina Brandt", "Halcyon Beteiligungs GmbH", 0, "control", "Geschäftsführung"),
    ("Lars Andersson", "Halcyon Beteiligungs GmbH", 25, "shares", ""),
    ("Brandt Familienholding GmbH", "Halcyon Beteiligungs GmbH", 75, "shares", ""),
    ("Halcyon Beteiligungs GmbH", "Halcyon Holding S.à r.l.", 100, "shares", ""),
    ("Halcyon Holding S.à r.l.", "Halcyon BidCo S.à r.l.", 100, "shares", ""),
    ("Halcyon BidCo S.à r.l.", "Meridian Logistics Park S.A.", 94, "shares", ""),
]
UBOS = [("Dr. Katharina Brandt", "ownership", 100, 0, "Germany")]
ATTRS = [
    ("Dr. Katharina Brandt", "Source of wealth", "Proceeds from the 2018 sale of a family-owned logistics operator; subsequent real-estate investments.", "Wealth memo"),
    ("Dr. Katharina Brandt", "PEP status", "Not a politically exposed person.", "Self-declaration"),
    ("Brandt Familienholding GmbH", "Registered address", "Maximilianstraße 35, 80539 München, Germany", "Handelsregister B"),
    ("Brandt Familienholding GmbH", "Registration number", "HRB 248115", "Handelsregister B"),
    ("Halcyon Beteiligungs GmbH", "Registered address", "Maximilianstraße 35, 80539 München, Germany", "Handelsregister B"),
    ("Halcyon Beteiligungs GmbH", "Tax residency", "Germany (Munich tax office)", "Tax ruling"),
    ("Halcyon BidCo S.à r.l.", "LEI", "529900HALCYONBIDCO45", "GLEIF"),
    ("Halcyon BidCo S.à r.l.", "Registered address", "12, rue Eugène Ruppert, L-2453 Luxembourg", "RCS Luxembourg"),
    ("Halcyon BidCo S.à r.l.", "Regulated status", "Not regulated — special-purpose acquisition vehicle, not a supervised financial institution.", "Legal opinion"),
    ("Halcyon BidCo S.à r.l.", "Source of funds", "Equity contributions from Halcyon Holding S.à r.l. and senior acquisition financing from Nordbank AG.", "Funds flow"),
    ("Meridian Logistics Park S.A.", "FATCA/CRS classification", "Passive Non-Financial Entity (Passive NFE)", "Self-certification"),
    ("Meridian Logistics Park S.A.", "Registered address", "5, avenue Gaston Diderich, L-1420 Luxembourg", "RCS Luxembourg"),
]

BRAIN = [  # prompt, value, times
    ("Full legal name of the contracting entity?", "Halcyon BidCo S.à r.l.", 3),
    ("Identify all ultimate beneficial owners holding 25% or more.",
     "Dr. Katharina Brandt — 100% (indirectly via Brandt Familienholding GmbH → Halcyon Beteiligungs GmbH).", 2),
    ("What is the source of funds for the transaction?",
     "Equity contributions from Halcyon Holding S.à r.l. and senior acquisition financing from Nordbank AG.", 2),
    ("Is the contracting entity a regulated financial institution?", "No.", 2),
    ("Is any beneficial owner a politically exposed person (PEP)?", "No.", 2),
]

FRESH = """1. Full legal name of the contracting entity?
2. Legal Entity Identifier (LEI)?
3. Registered office address?
4. Identify all ultimate beneficial owners holding 25% or more.
5. Is any beneficial owner a politically exposed person (PEP)?
6. What is the source of funds for the transaction?
7. Please attach a certified copy of the passport for each UBO."""


def is_seeded() -> bool:
    with db() as con:
        return one(con, "SELECT 1 FROM clients LIMIT 1") is not None


def seed() -> None:
    if is_seeded():
        return
    with db() as con:
        con.execute("INSERT INTO clients (id, name, deal_name) VALUES (?,?,?)", (CLIENT, "Brandt Family", "Project Halcyon"))
        ids = {}
        for name, kind, role, juris in ENTITIES:
            eid = gen_id("ent"); ids[name] = eid
            con.execute("INSERT INTO entities (id, client_id, name, kind, role, jurisdiction, as_of) VALUES (?,?,?,?,?,?, date('now'))",
                        (eid, CLIENT, name, kind, role, juris))
        for p, c, pct, kind, mech in EDGES:
            con.execute("INSERT INTO ownership_edges (id, client_id, parent_id, child_id, pct, kind, mechanism, as_of) VALUES (?,?,?,?,?,?,?, date('now'))",
                        (gen_id("edge"), CLIENT, ids[p], ids[c], pct, kind, mech))
        for ent, basis, pct, pep, res in UBOS:
            con.execute("INSERT INTO ubos (id, client_id, entity_id, basis, pct, pep, residence, as_of) VALUES (?,?,?,?,?,?,?, date('now'))",
                        (gen_id("ubo"), CLIENT, ids[ent], basis, pct, pep, res))
        for ent, key, val, src in ATTRS:
            con.execute("INSERT INTO entity_attributes (id, entity_id, key, value, source, as_of) VALUES (?,?,?,?,?, date('now'))",
                        (gen_id("attr"), ids[ent], key, val, src))
    for prompt, value, times in BRAIN:
        for _ in range(times):
            record_finalized_answer(prompt, value)
    create_questionnaire(CLIENT, "Banque de Genève SA", "Onboarding KYC – Acquisition SPV", FRESH)
