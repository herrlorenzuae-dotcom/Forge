"""Structure ingestion. Two ways to populate a project's structure:

  1. A real Share Purchase Agreement (or any structure doc): the model extracts
     entities, ownership percentages and control relationships (only when an
     ANTHROPIC_API_KEY is configured; names are masked on-device first).
  2. An explicit, deterministic spec (no key needed) — the same shape the model
     emits — so the feature always works:

        Brandt Familienholding GmbH -> Halcyon Beteiligungs GmbH : 75%
        Lars Andersson -> Halcyon Beteiligungs GmbH : 25%
        Armira I GP GmbH -> Halcyon Beteiligungs GmbH : control (General partner / Komplementär)
        TARGET: Meridian Logistics Park S.A.
        UBO: Dr. Katharina Brandt

Control captures the Komplementär case: in a GmbH & Co. KG the general partner
exercises control without an economic share."""
import re
import json
from ..db import db, gen_id
from .. import config, llm
from .. import anonymize

LEGAL = r"(?:GmbH & Co\. KG|GmbH & Co\. KGaA|GmbH|gGmbH|AG|KGaA|KG|S\.à r\.l\.|S\.A\.|S\.C\.S\.|SE & Co\. KG|SE|B\.V\.|N\.V\.|Ltd\.?|LLC|L\.P\.|LP|Holding|Beteiligungs[\wäöü-]*)"
EDGE_RE = re.compile(r"^\s*(?P<a>.+?)\s*-+>\s*(?P<b>.+?)\s*:\s*(?P<rel>.+?)\s*$")
PCT_RE = re.compile(r"(\d{1,3}(?:[.,]\d+)?)\s*%")


def _kind(name: str) -> str:
    if re.search(LEGAL, name):
        if re.search(r"S\.à r\.l\.|S\.A\.|S\.C\.S\.|SPV|BidCo|AcquiCo", name):
            return "spv"
        return "holding"
    return "individual"  # no legal form -> a person


def parse_structure_spec(text: str) -> dict:
    """Parse the explicit spec. Tolerant of blank lines and comments (#)."""
    entities, edges, ubos, target = {}, [], [], None

    def ent(n):
        n = n.strip()
        if n and n not in entities:
            entities[n] = {"name": n, "kind": _kind(n), "role": "other"}
        return n

    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.upper().startswith("UBO:"):
            n = ent(line.split(":", 1)[1]); ubos.append(n)
            entities[n]["role"] = "ubo"; continue
        if line.upper().startswith("TARGET:"):
            target = ent(line.split(":", 1)[1]); entities[target]["role"] = "target"; continue
        m = EDGE_RE.match(line)
        if not m:
            continue
        a, b, rel = ent(m["a"]), ent(m["b"]), m["rel"].strip()
        if rel.lower().startswith("control"):
            mech = re.search(r"\((.*?)\)", rel)
            edges.append({"parent": a, "child": b, "pct": 0.0, "kind": "control",
                          "mechanism": (mech.group(1).strip() if mech else "General partner (Komplementär)")})
        else:
            pm = PCT_RE.search(rel)
            edges.append({"parent": a, "child": b, "pct": float(pm.group(1).replace(",", ".")) if pm else 0.0,
                          "kind": "shares", "mechanism": ""})
    return {"entities": list(entities.values()), "edges": edges, "ubos": ubos, "target": target}


def extract_from_spa(text: str, project_id: str) -> dict:
    """Model-assisted extraction from a free-text SPA (needs a key); otherwise
    treat the text as the explicit spec."""
    if not config.HAS_KEY:
        return parse_structure_spec(text)
    import anthropic
    reg = anonymize.build_registry(project_id)  # mostly empty for a fresh project
    sys = ("Extract the ownership/control structure from this agreement as strict JSON: "
           "{\"edges\":[{\"parent\":str,\"child\":str,\"pct\":number,\"kind\":\"shares|control\",\"mechanism\":str}],"
           "\"ubos\":[str],\"target\":str}. Use 'control' (pct 0) for general-partner/Komplementär or other "
           "non-equity control; set mechanism accordingly. Names verbatim.")
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    resp = client.messages.create(model=config.MODEL, max_tokens=2000, system=sys,
                                  messages=[{"role": "user", "content": anonymize.mask(text[:12000], reg)}])
    raw = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
    raw = anonymize.restore(raw, reg)
    m, n = raw.find("{"), raw.rfind("}")
    data = json.loads(raw[m:n + 1]) if m >= 0 else {"edges": [], "ubos": [], "target": None}
    # normalise to spec shape (entities derived from edges)
    names = {}
    for e in data.get("edges", []):
        for k in ("parent", "child"):
            names.setdefault(e[k], {"name": e[k], "kind": _kind(e[k]), "role": "other"})
    for u in data.get("ubos", []):
        names.setdefault(u, {"name": u, "kind": _kind(u), "role": "other"})["role"] = "ubo"
    if data.get("target") and data["target"] in names:
        names[data["target"]]["role"] = "target"
    return {"entities": list(names.values()), "edges": data.get("edges", []),
            "ubos": data.get("ubos", []), "target": data.get("target")}


def apply_structure(project_id: str, spec: dict) -> dict:
    """Replace the project's structure with the parsed spec."""
    with db() as con:
        for t in ("ownership_edges", "ubos", "entities"):
            con.execute(f"DELETE FROM {t} WHERE client_id=?", (project_id,))
        ids = {}
        for e in spec["entities"]:
            eid = gen_id("ent"); ids[e["name"]] = eid
            con.execute("INSERT INTO entities (id, client_id, name, kind, role, as_of) VALUES (?,?,?,?,?, date('now'))",
                        (eid, project_id, e["name"], e["kind"], e.get("role", "other")))
        for e in spec["edges"]:
            if e["parent"] in ids and e["child"] in ids:
                con.execute("INSERT INTO ownership_edges (id, client_id, parent_id, child_id, pct, kind, mechanism, as_of) VALUES (?,?,?,?,?,?,?, date('now'))",
                            (gen_id("edge"), project_id, ids[e["parent"]], ids[e["child"]], e.get("pct", 0), e.get("kind", "shares"), e.get("mechanism", "")))
        for name in spec["ubos"]:
            if name in ids:
                con.execute("INSERT INTO ubos (id, client_id, entity_id, basis, pct, pep, residence, as_of) VALUES (?,?,?,?,?,?,?, date('now'))",
                            (gen_id("ubo"), project_id, ids[name], "ownership", 0, 0, ""))
    return {"entities": len(spec["entities"]), "edges": len(spec["edges"])}
