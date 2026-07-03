"""Structure ingestion. Two ways to populate a project's structure:

  1. A real Share Purchase Agreement (or any structure doc): the model extracts
     entities, ownership percentages and control relationships (only when an
     ANTHROPIC_API_KEY is configured; names are masked on-device first).
  2. An explicit, deterministic spec (no key needed) — the same shape the model
     emits — so the feature always works:

        Brandt Familienholding GmbH -> Halcyon Beteiligungs GmbH : 75%
        Lars Andersson -> Halcyon Beteiligungs GmbH : 25%
        Halcyon GP GmbH -> Halcyon Beteiligungs GmbH : control (General partner / Komplementär)
        TARGET: Meridian Logistics Park S.A.
        UBO: Dr. Katharina Brandt

Control captures the Komplementär case: in a GmbH & Co. KG the general partner
exercises control without an economic share."""
import re
import json
from ..db import db, gen_id
from .. import config, llm
from .. import anonymize

LEGAL = r"(?:GmbH & Co\. KG|GmbH & Co\. KGaA|GmbH|gGmbH|mbH|AG|KGaA|KG|S\.à r\.l\.|S\.A\.|S\.C\.S\.|SE & Co\. KG|SE|B\.V\.|N\.V\.|Ltd\.?|LLC|L\.P\.|LP|Holding|Beteiligungs[\wäöü-]*|Verwaltungs[\wäöü-]*|Inc\.?)"
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
        if rel.lower().startswith("attribution"):
            edges.append({"parent": a, "child": b, "pct": 0.0, "kind": "attribution",
                          "mechanism": "per Transparenzregister"})
        elif rel.lower().startswith("control"):
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


def structure_to_spec(project_id: str) -> str:
    """Serialise the current structure back to the editable spec, so it can be
    reviewed and corrected by hand."""
    from .structure import get_structure
    s = get_structure(project_id)
    name = {e["id"]: e["name"] for e in s["entities"]}
    lines = []
    for e in s["edges"]:
        a, b = name.get(e["parent_id"], "?"), name.get(e["child_id"], "?")
        if e["kind"] == "attribution":
            lines.append(f"{a} -> {b} : attribution (per Transparenzregister)")
        elif e["kind"] == "control":
            lines.append(f"{a} -> {b} : control ({e['mechanism'] or 'General partner / Komplementär'})")
        else:
            pct = (str(int(e["pct"])) if float(e["pct"]).is_integer() else f"{e['pct']}")
            lines.append(f"{a} -> {b} : {pct}%")
    tgt = next((e["name"] for e in s["entities"] if e["role"] == "target"), None)
    if tgt:
        lines.append(f"TARGET: {tgt}")
    for u in s["ubos"]:
        lines.append(f"UBO: {u['entity_name']}")
    return "\n".join(lines)


def apply_structure(project_id: str, spec: dict) -> dict:
    """Replace the project's structure with the parsed spec."""
    with db() as con:
        for t in ("ownership_edges", "ubos", "entities"):
            con.execute(f"DELETE FROM {t} WHERE client_id=?", (project_id,))
        ids = {}
        for e in spec["entities"]:
            eid = gen_id("ent"); ids[e["name"]] = eid
            con.execute("INSERT INTO entities (id, client_id, name, kind, role, registration_no, as_of) VALUES (?,?,?,?,?,?, date('now'))",
                        (eid, project_id, e["name"], e["kind"], e.get("role", "other"), e.get("registration_no", "")))
            if e.get("directors"):
                con.execute("INSERT INTO entity_attributes (id, entity_id, key, value, source, as_of) VALUES (?,?,?,?,?, date('now'))",
                            (gen_id("attr"), eid, "Directors", "; ".join(e["directors"]), "chart import"))
        for e in spec["edges"]:
            if e["parent"] in ids and e["child"] in ids:
                con.execute("INSERT INTO ownership_edges (id, client_id, parent_id, child_id, pct, kind, mechanism, as_of) VALUES (?,?,?,?,?,?,?, date('now'))",
                            (gen_id("edge"), project_id, ids[e["parent"]], ids[e["child"]], e.get("pct", 0), e.get("kind", "shares"), e.get("mechanism", "")))
        for name in spec["ubos"]:
            if name in ids:
                con.execute("INSERT INTO ubos (id, client_id, entity_id, basis, pct, pep, residence, as_of) VALUES (?,?,?,?,?,?,?, date('now'))",
                            (gen_id("ubo"), project_id, ids[name], "ownership", 0, 0, ""))
    return {"entities": len(spec["entities"]), "edges": len(spec["edges"])}


def merge_structure(project_id: str, spec: dict, attach_to: str = "", attach_rel: str = "") -> dict:
    """Graft the parsed spec INTO the existing structure instead of replacing it.
    Entities are matched by name (case-insensitive) and reused; new ones are
    added; duplicate edges are skipped. If attach_to (an existing entity id) is
    given, every root of the new spec (an entity without a parent inside the
    spec) is hung underneath it — attach_rel is either a percentage ("80") or
    "control" (general partner / Komplementär)."""
    from .structure import get_structure
    s = get_structure(project_id)
    ids = {e["name"].lower(): e["id"] for e in s["entities"]}
    have_edge = {(e["parent_id"], e["child_id"]) for e in s["edges"]}
    have_ubo = {u["entity_id"] for u in s["ubos"]}
    added_e = added_edges = 0
    with db() as con:
        for e in spec["entities"]:
            key = e["name"].lower()
            if key in ids:
                continue
            eid = gen_id("ent"); ids[key] = eid; added_e += 1
            con.execute("INSERT INTO entities (id, client_id, name, kind, role, registration_no, as_of) VALUES (?,?,?,?,?,?, date('now'))",
                        (eid, project_id, e["name"], e["kind"], e.get("role", "other"), e.get("registration_no", "")))
            if e.get("directors"):
                con.execute("INSERT INTO entity_attributes (id, entity_id, key, value, source, as_of) VALUES (?,?,?,?,?, date('now'))",
                            (gen_id("attr"), eid, "Directors", "; ".join(e["directors"]), "chart import"))
        for e in spec["edges"]:
            p, c = ids.get(e["parent"].lower()), ids.get(e["child"].lower())
            if not p or not c or (p, c) in have_edge:
                continue
            con.execute("INSERT INTO ownership_edges (id, client_id, parent_id, child_id, pct, kind, mechanism, as_of) VALUES (?,?,?,?,?,?,?, date('now'))",
                        (gen_id("edge"), project_id, p, c, e.get("pct", 0), e.get("kind", "shares"), e.get("mechanism", "")))
            have_edge.add((p, c)); added_edges += 1
        for name in spec["ubos"]:
            eid = ids.get(name.lower())
            if eid and eid not in have_ubo:
                con.execute("INSERT INTO ubos (id, client_id, entity_id, basis, pct, pep, residence, as_of) VALUES (?,?,?,?,?,?,?, date('now'))",
                            (gen_id("ubo"), project_id, eid, "ownership", 0, 0, ""))
                con.execute("UPDATE entities SET role='ubo' WHERE id=? AND role='other'", (eid,))
        # hang the new structure's roots under the chosen anchor
        if attach_to:
            children_in_spec = {e["child"].lower() for e in spec["edges"]}
            parents_in_spec = {e["parent"].lower() for e in spec["edges"]}
            # roots: top of the pasted chain — parents that are nobody's child;
            # a single-entity spec (just the new company) is its own root
            root_names = [n for n in parents_in_spec if n not in children_in_spec] or \
                         ([spec["entities"][0]["name"].lower()] if len(spec["entities"]) == 1 else [])
            roots = [ids[n] for n in root_names if n in ids]
            rel = (attach_rel or "").strip().lower()
            ctrl = rel.startswith("control") or rel in ("gp", "komplementär", "komplementar")
            pm = PCT_RE.search(attach_rel or "")
            pct = float(pm.group(1).replace(",", ".")) if pm else (0.0 if ctrl else 100.0)
            for r in roots:
                if r != attach_to and (attach_to, r) not in have_edge:
                    con.execute("INSERT INTO ownership_edges (id, client_id, parent_id, child_id, pct, kind, mechanism, as_of) VALUES (?,?,?,?,?,?,?, date('now'))",
                                (gen_id("edge"), project_id, attach_to, r,
                                 0 if ctrl else pct, "control" if ctrl else "shares",
                                 "General partner (Komplementär)" if ctrl else ""))
                    have_edge.add((attach_to, r)); added_edges += 1
    return {"entities": added_e, "edges": added_edges}


def copy_structure(dst_project_id: str, src_project_id: str) -> dict:
    """Take over an existing chart from another project as the starting point."""
    spec_text = structure_to_spec(src_project_id)
    if not spec_text.strip():
        return {"entities": 0, "edges": 0}
    return apply_structure(dst_project_id, parse_structure_spec(spec_text))
