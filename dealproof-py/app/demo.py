"""Optional demo project with dummy data — created once on startup so a new
user can see the full flow (structure incl. Komplementär control, a parsed
questionnaire, and an analysis spanning every source). It is just one entry in
the project list; delete it and it only returns on a fresh database."""
from .db import db, one, gen_id
from .engine import spa, projects, brain

DEMO_ID = "proj_demo"
DEMO_NAME = "Demo — Project Cedar (acquisition of Helio Thermal Systems)"

# A realistic, FICTIONAL PE structure modelled on the Armira shape: a GmbH &
# Co. KG cascade where each KG is controlled by its general partner (Komplementär)
# with no equity, running from the portfolio company up through the fund and
# feeder vehicles to the individual partners. Names/figures are invented.
SPEC = """\
# Asset and acquisition vehicle
Cedar BidCo S.à r.l. -> Helio Thermal Systems GmbH : 94%
# Deal fund (the project vehicle), controlled by its Komplementär
Cedar Blue GP GmbH -> Cedar Blue GmbH & Co. geschlossene Investment KG : control (General partner / Komplementär)
Cedar Blue GmbH & Co. geschlossene Investment KG -> Cedar BidCo S.à r.l. : 100%
Cedar Blue Initiators GmbH & Co. KG -> Cedar Blue GmbH & Co. geschlossene Investment KG : 8%
Cedar Blue Team GmbH & Co. KG -> Cedar Blue GmbH & Co. geschlossene Investment KG : 5%
Cedar Beteiligungen GmbH & Co. KG -> Cedar Blue GmbH & Co. geschlossene Investment KG : 87%
# Main fund holding, controlled by its Komplementär
Cedar Beteiligungen Verwaltungs GmbH -> Cedar Beteiligungen GmbH & Co. KG : control (General partner / Komplementär)
Cedar GmbH & Co. KG -> Cedar Beteiligungen GmbH & Co. KG : 100%
# Top partnership, controlled by its Komplementär
Cedar Verwaltungs GmbH -> Cedar GmbH & Co. KG : control (General partner / Komplementär)
# Partners (limited partners) hold the economic interest in the top KG
Dr. Anna Vogt -> Cedar GmbH & Co. KG : 28%
Maximilian Stein -> Cedar GmbH & Co. KG : 22%
Sofia Brandt -> Cedar GmbH & Co. KG : 18%
Further partners (11) -> Cedar GmbH & Co. KG : 32%
# Control of the group runs through the managing partners of the top Komplementär
Dr. Anna Vogt -> Cedar Verwaltungs GmbH : control (Managing partner)
Maximilian Stein -> Cedar Verwaltungs GmbH : control (Managing partner)
TARGET: Helio Thermal Systems GmbH
UBO: Dr. Anna Vogt
UBO: Maximilian Stein
"""

# (entity name, key, value, source) — a couple of facts already "on file"
ATTRS = [
    ("Cedar BidCo S.à r.l.", "LEI", "391200CEDARBIDCO0007", "GLEIF"),
]

# prior verified answers folded into the Brain (so some questions resolve there)
BRAIN = [
    ("Full legal name of the contracting entity?", "Cedar BidCo S.à r.l.", 3),
    ("Is the contracting entity a regulated financial institution?", "No — special-purpose acquisition vehicle, not a supervised institution.", 2),
    ("What is the source of funds for the transaction?",
     "Equity drawn from Cedar Blue GmbH & Co. geschlossene Investment KG (partner commitments) plus senior acquisition financing.", 2),
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
