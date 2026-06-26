"""Citation verification — an answer may only rest on a fact that exists, and
the quote must appear (verbatim, normalized) in that fact."""
import re
from ..db import db, one


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").lower()).replace("’", "'").strip()


def fact_text(fact_type: str, fact_id: str) -> str:
    with db() as con:
        if fact_type == "attribute":
            r = one(con, "SELECT key, value FROM entity_attributes WHERE id=?", (fact_id,))
            return f"{r['key']}: {r['value']}" if r else ""
        if fact_type == "entity":
            r = one(con, "SELECT name, kind, role, jurisdiction, registration_no, incorporation_date FROM entities WHERE id=?", (fact_id,))
            return " ".join(str(r[k]) for k in r) if r else ""
        if fact_type == "edge":
            r = one(con, "SELECT p.name AS p, c.name AS c, e.pct, e.kind FROM ownership_edges e JOIN entities p ON p.id=e.parent_id JOIN entities c ON c.id=e.child_id WHERE e.id=?", (fact_id,))
            return f"{r['p']} owns {r['pct']}% of {r['c']} ({r['kind']})" if r else ""
        if fact_type == "ubo":
            r = one(con, "SELECT en.name AS name, u.basis, u.pct, u.pep, u.residence FROM ubos u JOIN entities en ON en.id=u.entity_id WHERE u.id=?", (fact_id,))
            return f"{r['name']} {r['basis']} {r['pct']}% {'PEP' if r['pep'] else 'not PEP'} {r['residence']}" if r else ""
    return ""


def verify_citations(citations: list) -> list:
    out = []
    for c in citations or []:
        ft = fact_text(c.get("factType", ""), c.get("factId", ""))
        ok = bool(ft) and _norm(c.get("quote", "")) in _norm(ft)
        out.append({**c, "verified": ok})
    return out
