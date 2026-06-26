"""Read the client's structure from the store."""
from ..db import db, rows


def get_structure(client_id: str) -> dict:
    with db() as con:
        entities = rows(con, "SELECT * FROM entities WHERE client_id=? ORDER BY role, name", (client_id,))
        edges = rows(con, "SELECT * FROM ownership_edges WHERE client_id=?", (client_id,))
        ubos = rows(con, "SELECT u.*, e.name AS entity_name FROM ubos u JOIN entities e ON e.id=u.entity_id WHERE u.client_id=?", (client_id,))
        ids = tuple(e["id"] for e in entities) or ("",)
        ph = ",".join("?" for _ in ids)
        attrs = rows(con, f"SELECT a.*, e.name AS entity_name FROM entity_attributes a JOIN entities e ON e.id=a.entity_id WHERE a.entity_id IN ({ph})", ids)
    return {"entities": entities, "edges": edges, "ubos": ubos, "attributes": attrs}


def structure_context(client_id: str) -> str:
    """Compact id-tagged dump for the model to map against."""
    s = get_structure(client_id)
    name = {e["id"]: e["name"] for e in s["entities"]}
    out = ["ENTITIES"]
    for e in s["entities"]:
        out.append(f"- entity {e['id']} | {e['name']} | {e['kind']} | role={e['role']} | {e['jurisdiction']} | reg={e['registration_no'] or '—'}")
    out.append("\nOWNERSHIP / CONTROL")
    for e in s["edges"]:
        if e["kind"] == "control":
            rel = f"controls {name.get(e['child_id'],'?')} ({e['mechanism'] or 'control'})"
        else:
            rel = f"owns {e['pct']}% of {name.get(e['child_id'],'?')}"
        out.append(f"- edge {e['id']} | {name.get(e['parent_id'],'?')} {rel}")
    out.append("\nBENEFICIAL OWNERS")
    for u in s["ubos"]:
        out.append(f"- ubo {u['id']} | {u['entity_name']} | basis={u['basis']} | {u['pct']}% | {'PEP' if u['pep'] else 'not PEP'} | {u['residence']}")
    out.append("\nATTRIBUTES")
    for a in s["attributes"]:
        out.append(f"- attribute {a['id']} | {a['entity_name']} | {a['key']} = {a['value']} | source={a['source']}")
    return "\n".join(out)
