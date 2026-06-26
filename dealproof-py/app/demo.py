"""Optional demo project with dummy data — created once on startup so a new
user can see the full flow (structure incl. Komplementär control, a parsed
questionnaire, and an analysis spanning every source). It is just one entry in
the project list; delete it and it only returns on a fresh database."""
from .db import db, one, gen_id
from .engine import spa, projects, brain

DEMO_ID = "proj_demo"
DEMO_NAME = "Demo — Project Atlas (Bank onboarding)"

SPEC = """\
Dr. Katharina Brandt -> Brandt Familienholding GmbH : 100%
Brandt Familienholding GmbH -> Halcyon Beteiligungs GmbH : 75%
Lars Andersson -> Halcyon Beteiligungs GmbH : 25%
Armira I GP GmbH -> Halcyon Beteiligungs GmbH : control (General partner / Komplementär)
Halcyon Beteiligungs GmbH -> Halcyon Holding S.à r.l. : 100%
Halcyon Holding S.à r.l. -> Halcyon BidCo S.à r.l. : 100%
Halcyon BidCo S.à r.l. -> Meridian Logistics Park S.A. : 94%
TARGET: Meridian Logistics Park S.A.
UBO: Dr. Katharina Brandt
"""

# (entity name, key, value, source) — a couple of facts already "on file"
ATTRS = [
    ("Halcyon BidCo S.à r.l.", "LEI", "529900HALCYONBIDCO45", "GLEIF"),
]

# prior verified answers folded into the Brain (so some questions resolve there)
BRAIN = [
    ("Full legal name of the contracting entity?", "Halcyon BidCo S.à r.l.", 3),
    ("Is the contracting entity a regulated financial institution?", "No — special-purpose acquisition vehicle, not a supervised institution.", 2),
    ("What is the source of funds for the transaction?",
     "Equity contributions from Halcyon Holding S.à r.l. and senior acquisition financing from Nordbank AG.", 2),
]

QUESTIONNAIRE = """\
1. Full legal name of the contracting entity?
2. Legal Entity Identifier (LEI)?
3. Registered office address?
4. Date of incorporation?
5. Is the contracting entity a regulated financial institution?
6. Identify all ultimate beneficial owners holding 25% or more.
7. Is any beneficial owner a politically exposed person (PEP)?
8. Tax residence of the contracting entity?
9. What is the source of funds for the transaction?
10. What is the purpose of the business relationship?
11. Please attach a certified copy of the passport for each UBO.
"""


def seed_demo() -> None:
    with db() as con:
        if one(con, "SELECT 1 FROM clients WHERE id=?", (DEMO_ID,)):
            return
        con.execute("INSERT INTO clients (id, name, status, updated_at) VALUES (?,?, 'open', datetime('now'))",
                    (DEMO_ID, DEMO_NAME))

    spa.apply_structure(DEMO_ID, spa.parse_structure_spec(SPEC))

    with db() as con:
        for ent_name, key, value, src in ATTRS:
            row = one(con, "SELECT id FROM entities WHERE client_id=? AND name=?", (DEMO_ID, ent_name))
            if row:
                con.execute("INSERT INTO entity_attributes (id, entity_id, key, value, source, as_of) VALUES (?,?,?,?,?, date('now'))",
                            (gen_id("attr"), row["id"], key, value, src))

    for prompt, value, n in BRAIN:
        for _ in range(n):
            brain.record_finalized_answer(prompt, value)

    projects.add_document(DEMO_ID, "Bank-onboarding-KYC.txt", QUESTIONNAIRE, "Banque de Genève SA")
