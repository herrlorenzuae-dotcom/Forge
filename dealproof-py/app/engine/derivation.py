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


def _fmt(p: float) -> str:
    return f"{p:g}".replace(".", ",")


def _prose(name: str, hops: list) -> str:
    """The strand as one readable sentence — the wording a reviewer at the bank
    would write themselves ("holds 100 % of X, which as Komplementär controls Y")."""
    bits = []
    for h in hops:
        if h["kind"] == "control":
            bits.append(f"as {h['label'] or 'controlling party'} controls {h['to']}")
        elif h["kind"] == "attribution":
            bits.append(f"is {h['label']} of {h['to']}")
        else:
            bits.append(f"holds {h['label']} of {h['to']}")
    return f"{name} " + ", which ".join(bits) + "."


def _why(u: dict, strands: list, control_strands: list) -> str:
    """One plain sentence answering the reviewer's first question: capital or
    control — and if control, why capital does NOT carry the position."""
    note = u.get("note") or ""
    best = max((s["cum"] or 0) for s in strands) if strands else 0.0
    if u.get("basis") == "control" and control_strands:
        if "Fiktiver" in note or "gesetzlicher Vertreter" in note:
            return ("No actual beneficial owner could be determined, so the legal representative counts "
                    "as (fictitious) beneficial owner — the strand below anchors that function in the structure.")
        lead = "Not a capital position — the capital sits dispersed below"
        if best <= 25:
            lead += " (no modelled strand exceeds 25 %)"
        return (lead + ". The position follows from control over the general-partner "
                "(Komplementär) chain; every hop of that chain is shown below and in the chart (highlighted red).")
    pct = float(u.get("pct") or 0)
    if pct > 25:
        return f"Capital position: {_fmt(pct)} % per register — above the 25 % threshold (§ 3 Abs. 2 S. 1 GwG)."
    if best > 25:
        return f"Capital position: cumulatively {_fmt(best)} % through the strand(s) below — above the 25 % threshold."
    if strands or control_strands:
        return "Basis per register (see note); the strand(s) below show how the position runs through the structure."
    return ""


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
            ubo_name = u.get("entity_name") or name.get(eid, "?")
            entry = {"hops": hops, "cum": round(cum * 100, 2) if pure_capital else None,
                     "prose": _prose(ubo_name, hops)}
            (strands if pure_capital else control_strands).append(entry)
        if not strands and not control_strands:
            attribution = attribution or any(
                e["kind"] == "attribution" and e["parent_id"] == eid for e in s["edges"])
        result.append({"entity_id": eid, "name": u.get("entity_name") or name.get(eid, "?"),
                       "basis": u.get("basis", ""), "pct": u.get("pct", 0),
                       "note": u.get("note", ""), "residence": u.get("residence", ""),
                       "pep": u.get("pep", 0),
                       "strands": strands, "control_strands": control_strands,
                       "attribution": attribution,
                       "why": _why(u, strands, control_strands)})
    return result
