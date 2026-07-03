"""UBO derivation — the bank-checkable answer to "WHY is this person the UBO?"

For every recorded beneficial owner this walks the structure downwards to the
subject company and produces the strands:
  · capital strands: every ownership path with the percentage per hop and the
    CUMULATIVE share (product), so the >25% threshold can be re-computed
  · control strands: paths that run over control edges (general partner /
    Komplementär, managing partner)
  · attribution-only: the register names the person but the chain is not in
    the chart yet — flagged honestly instead of faking a strand

Together with the stored register basis (§ note on the UBO record) this gives
the full reasoning: WHO, over WHICH strand, on WHAT legal basis."""
from .structure import get_structure
from .orgchart import build_orgchart, default_subject

MAX_PATHS, MAX_DEPTH = 6, 14


def ubo_derivation(project_id: str, subject: str = None) -> list:
    s = get_structure(project_id)
    data = build_orgchart(project_id)
    if not data["nodes"]:
        return []
    subj = subject or default_subject(data["nodes"], data["edges"])
    name = {e["id"]: e["name"] for e in s["entities"]}
    children = {}
    for e in s["edges"]:
        children.setdefault(e["parent_id"], []).append(e)

    def paths_down(start):
        out = []

        def dfs(cur, hops, seen):
            if len(out) >= MAX_PATHS or len(hops) > MAX_DEPTH:
                return
            if cur == subj and hops:
                out.append(list(hops))
                return
            for e in children.get(cur, []):
                if e["child_id"] in seen:
                    continue
                hops.append(e)
                dfs(e["child_id"], hops, seen | {e["child_id"]})
                hops.pop()

        dfs(start, [], {start})
        return out

    result = []
    for u in s["ubos"]:
        eid = u["entity_id"]
        strands, control_strands, attribution = [], [], False
        for path in paths_down(eid):
            kinds = [e["kind"] for e in path]
            # a leading attribution hop (fictitious UBO anchored at the entity
            # they legally represent) is traceable — anything else attribution-
            # tainted is only a register statement without a modelled chain
            if "attribution" in kinds and not (kinds[0] == "attribution" and "attribution" not in kinds[1:]):
                attribution = True
                continue
            hops = []
            cum = 1.0
            pure_capital = True
            for e in path:
                if e["kind"] == "attribution":
                    label = e["mechanism"] or "per Transparenzregister"
                    pure_capital = False
                elif e["kind"] == "control":
                    label = e["mechanism"] or "Control"
                    pure_capital = False
                else:
                    p = float(e["pct"] or 0)
                    label = (f"{p:g}".replace(".", ",") + " %") if p else "n/a %"
                    cum *= (p / 100.0) if p else 0
                hops.append({"frm": name.get(e["parent_id"], "?"), "to": name.get(e["child_id"], "?"),
                             "label": label, "kind": e["kind"]})
            entry = {"hops": hops, "cum": round(cum * 100, 2) if pure_capital else None}
            (strands if pure_capital else control_strands).append(entry)
        if not strands and not control_strands:
            attribution = attribution or any(
                e["kind"] == "attribution" and e["parent_id"] == eid for e in s["edges"])
        result.append({"entity_id": eid, "name": u.get("entity_name") or name.get(eid, "?"),
                       "basis": u.get("basis", ""), "pct": u.get("pct", 0),
                       "note": u.get("note", ""), "residence": u.get("residence", ""),
                       "pep": u.get("pep", 0),
                       "strands": strands, "control_strands": control_strands,
                       "attribution": attribution})
    return result
