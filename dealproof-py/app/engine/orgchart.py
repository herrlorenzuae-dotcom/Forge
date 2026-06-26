"""Org chart: data projection + server-rendered SVG in the DealProof palette."""
from html import escape
from .structure import get_structure

BLUE = "#1c86c8"; BLUE_FILL = "#d7ecfb"; INK = "#13344d"; FOG = "#6d6a63"
RED = "#d62518"; GREEN = "#00a14b"; GREEN_FILL = "#d8f0e2"; CHART_BG = "#eef7fe"
BOX_W, BOX_H, COL, ROW, PAD = 188, 64, 224, 150, 40


def build_orgchart(client_id: str) -> dict:
    s = get_structure(client_id)
    nodes = [{"id": e["id"], "name": e["name"], "kind": e["kind"], "role": e["role"], "jurisdiction": e["jurisdiction"]} for e in s["entities"]]
    edges = [{"parent": e["parent_id"], "child": e["child_id"], "pct": e["pct"], "kind": e["kind"], "mechanism": e["mechanism"]}
             for e in s["edges"] if any(n["id"] == e["parent_id"] for n in nodes) and any(n["id"] == e["child_id"] for n in nodes)]
    return {"nodes": nodes, "edges": edges}


def _layout(nodes, edges):
    ids = [n["id"] for n in nodes]
    idset = set(ids)
    depth = {i: 0 for i in ids}
    for _ in range(len(ids)):
        changed = False
        for e in edges:
            if e["parent"] in idset and e["child"] in idset and depth[e["child"]] < depth[e["parent"]] + 1:
                depth[e["child"]] = depth[e["parent"]] + 1
                changed = True
        if not changed:
            break
    maxd = max(depth.values()) if depth else 0
    layers = [[] for _ in range(maxd + 1)]
    for i in ids:
        layers[depth[i]].append(i)
    parents = {i: [e["parent"] for e in edges if e["child"] == i] for i in ids}
    children = {i: [e["child"] for e in edges if e["parent"] == i] for i in ids}
    for _ in range(4):
        for d in range(1, maxd + 1):
            idx = {x: k for k, x in enumerate(layers[d - 1])}
            layers[d].sort(key=lambda i: (sum(idx.get(p, 0) for p in parents[i]) / len(parents[i])) if parents[i] else 1e9)
        for d in range(maxd - 1, -1, -1):
            idx = {x: k for k, x in enumerate(layers[d + 1])}
            layers[d].sort(key=lambda i: (sum(idx.get(c, 0) for c in children[i]) / len(children[i])) if children[i] else 1e9)
    widest = max((len(l) for l in layers), default=1)
    pos = {}
    for d, layer in enumerate(layers):
        off = (widest - len(layer)) * COL / 2
        for k, i in enumerate(layer):
            pos[i] = (PAD + off + k * COL, PAD + d * ROW)
    return pos, PAD * 2 + widest * COL, PAD * 2 + (maxd + 1) * ROW


def _accent(role):
    if role in ("ubo", "acquisition_vehicle"):
        return RED
    if role == "target":
        return GREEN
    return BLUE


def default_subject(nodes, edges) -> str | None:
    """The entity the KYC request concerns: the target/portfolio company, else a
    sink node (one that is owned but owns nothing)."""
    tgt = next((n["id"] for n in nodes if n["role"] == "target"), None)
    if tgt:
        return tgt
    parents = {e["parent"] for e in edges}
    children = {e["child"] for e in edges}
    sinks = [n["id"] for n in nodes if n["id"] in children and n["id"] not in parents]
    return sinks[0] if sinks else (nodes[0]["id"] if nodes else None)


def ancestors(subject: str, edges) -> set:
    """All entities above the subject — follow child→parent over BOTH ownership
    and control edges, so general partners (Komplementär) are included."""
    up = {}
    for e in edges:
        up.setdefault(e["child"], []).append(e["parent"])
    seen, stack = {subject}, [subject]
    while stack:
        cur = stack.pop()
        for p in up.get(cur, []):
            if p not in seen:
                seen.add(p); stack.append(p)
    return seen


def render_svg(client_id: str, subject: str = None, excerpt: bool = False) -> str:
    data = build_orgchart(client_id)
    nodes, edges = data["nodes"], data["edges"]
    if not nodes:
        return '<p class="muted">No structure yet — add it from a Share Purchase Agreement on the project page.</p>'
    if excerpt:
        subj = subject or default_subject(nodes, edges)
        keep = ancestors(subj, edges) if subj else {n["id"] for n in nodes}
        nodes = [n for n in nodes if n["id"] in keep]
        edges = [e for e in edges if e["parent"] in keep and e["child"] in keep]
    pos, w, h = _layout(nodes, edges)
    pct = lambda p: (str(int(p)) if float(p).is_integer() else f"{p:.2f}").replace(".", ",") + " %"
    parts = [f'<svg viewBox="0 0 {w} {h}" style="width:100%;height:auto;font-family:\'Hanken Grotesk\',sans-serif;background:{CHART_BG};border-radius:6px">',
             f'<defs><marker id="arr" markerWidth="9" markerHeight="9" refX="6" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 Z" fill="{BLUE}"/></marker></defs>']
    for e in edges:
        if e["parent"] not in pos or e["child"] not in pos:
            continue
        ax, ay = pos[e["parent"]]; bx, by = pos[e["child"]]
        x1, y1 = ax + BOX_W / 2, ay + BOX_H; x2, y2 = bx + BOX_W / 2, by; my = (y1 + y2) / 2
        ctrl = e["kind"] == "control"
        dash = ' stroke-dasharray="5 3"' if ctrl else ""
        parts.append(f'<path d="M{x1},{y1} L{x1},{my} L{x2},{my} L{x2},{y2}" fill="none" stroke="{BLUE}" stroke-width="1.3"{dash} marker-end="url(#arr)"/>')
        label = ("Control" if ctrl else (pct(e["pct"]) if e["pct"] else ""))
        if label:
            mx = (x1 + x2) / 2
            parts.append(f'<rect x="{mx-22}" y="{my-8}" width="44" height="16" rx="3" fill="{CHART_BG}"/>'
                         f'<text x="{mx}" y="{my+4}" text-anchor="middle" font-size="10.5" fill="{INK}">{escape(label)}</text>')
    for n in nodes:
        x, y = pos[n["id"]]
        green = n["role"] == "target" or n["kind"] == "operating"
        fill = GREEN_FILL if green else BLUE_FILL
        stroke = GREEN if green else BLUE
        parts.append(f'<rect x="{x+2}" y="{y+3}" width="{BOX_W}" height="{BOX_H}" rx="6" fill="rgba(19,52,77,.10)"/>')
        parts.append(f'<rect x="{x}" y="{y}" width="{BOX_W}" height="{BOX_H}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1"/>')
        parts.append(f'<rect x="{x}" y="{y}" width="5" height="{BOX_H}" rx="2" fill="{_accent(n["role"])}"/>')
        if n["kind"] != "individual":
            parts.append(f'<path d="M{x+BOX_W-16},{y+1} L{x+BOX_W-1},{y+1} L{x+BOX_W-1},{y+16} Z" fill="{RED}"/>')
        nm = escape(n["name"])
        nm = (nm[:38] + "…") if len(nm) > 39 else nm
        parts.append(f'<text x="{x+12}" y="{y+24}" font-size="11.5" font-family="\'Source Serif 4\',Georgia,serif" fill="{"#0a6e38" if green else INK}">{nm}</text>')
        parts.append(f'<text x="{x+12}" y="{y+BOX_H-9}" font-size="9" fill="{FOG}">{escape(n["jurisdiction"] or n["kind"])}</text>')
    parts.append("</svg>")
    return "".join(parts)
