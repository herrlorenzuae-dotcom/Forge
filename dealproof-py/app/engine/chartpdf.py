"""Rebuild a structure from a DRAWN chart PDF (vector org chart).

A vector chart carries its names, percentages and geometry as real data, so
the whole structure can be read fully locally — nothing goes to a model. This
matters for confidential group charts.

Method (ported from the proven kyc-deal extractor):
  boxes  : drawing bounding-boxes (filled rects OR 3-4 line borders) of
           plausible size, deduped; entity text assigned by centre-containment;
           colour classifies the kind (green=operating, grey=individual,
           else holding).
  labels : "x,xx% (y,yy%)" text blocks — the parenthesised second figure is a
           preferred-capital share, kept in `mechanism`.
  edges  : each percentage label anchors between the nearest box above
           (parent) and below (child) with x-overlap. One label -> one edge.

The result is a DRAFT in the same spec shape the SPA import produces —
reviewable and correctable in the hand-edit box on the Structure page.
"""
import re
from collections import Counter

PCT = r"\(?\d{1,3},\d{2}%?\)?"


def _classify(fill):
    if fill is None:
        return "white"
    r, g, b = fill
    if (round(r, 2), round(g, 2), round(b, 2)) == (1, 1, 1):
        return "white"
    if g > 0.5 and r < 0.3:
        return "green"
    if r > 0.7 and g < 0.3:
        return "red"
    if b > 0.85 and r > 0.6:
        return "blue"
    if abs(r - g) < 0.06 and abs(g - b) < 0.06:
        return "grey"
    return "white"


KIND = {"green": "operating", "grey": "individual", "white": "holding", "blue": "holding", "red": "holding"}


def is_chart_pdf(data: bytes) -> bool:
    """A drawn chart: lots of vector drawings and percentage labels."""
    try:
        import fitz
        doc = fitz.open(stream=data, filetype="pdf")
        page = doc[0]
        if len(page.get_drawings()) < 40:
            return False
        pcts = sum(1 for w in page.get_text("words") if re.fullmatch(PCT, w[4]))
        return pcts >= 3
    except Exception:
        return False


def extract_spec(data: bytes, xtol: float = 40):
    """Extract the chart into the structure-spec shape
    ({entities, edges, ubos, target}) or None if it doesn't look like a chart."""
    try:
        import fitz
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        return None
    page = doc[0]

    # ── boxes ──
    boxes = []
    for d in page.get_drawings():
        kinds = Counter(it[0] for it in d["items"])
        r = d["rect"]
        boxlike = 30 < r.width < 470 and 12 < r.height < 240
        if (kinds.get("re") and boxlike) or (
            kinds.get("l", 0) >= 3 and not kinds.get("re") and boxlike and r.width >= r.height
        ):
            boxes.append({"r": fitz.Rect(r), "cls": _classify(d.get("fill"))})
    boxes.sort(key=lambda b: (0 if b["cls"] in ("green", "blue", "red") else 1))
    deduped = []
    for b in boxes:
        cx, cy = (b["r"].x0 + b["r"].x1) / 2, (b["r"].y0 + b["r"].y1) / 2
        if any(abs(cx - (o["r"].x0 + o["r"].x1) / 2) < 5 and abs(cy - (o["r"].y0 + o["r"].y1) / 2) < 5 for o in deduped):
            continue
        deduped.append(b)
    boxes = deduped
    if len(boxes) < 3:
        return None

    words = page.get_text("words")

    def name_in(r):
        ws = [w for w in words if r.x0 - 1 <= (w[0] + w[2]) / 2 <= r.x1 + 1 and r.y0 - 1 <= (w[1] + w[3]) / 2 <= r.y1 + 1]
        ws.sort(key=lambda w: (round(w[1] / 3), w[0]))
        return " ".join(w[4] for w in ws if not re.fullmatch(PCT + r"|[,]", w[4])).strip()

    FRAGMENT = re.compile(r"(?i)^(?:&?\s*Co\.?\s*KG|GmbH|GbR|KG|AG|GP|SE|Verwaltungs\s*GmbH)$")

    def clean_name(s):
        s = re.sub(r"\s+", " ", s).strip()
        # shadow text doubles every word ("J.F. J.F. Müller Müller") — collapse
        words_ = s.split()
        out = [w for i, w in enumerate(words_) if i == 0 or w != words_[i - 1]]
        return " ".join(out)

    for i, b in enumerate(boxes):
        b["id"] = i
        b["name"] = clean_name(name_in(b["r"]))
        b["cx"] = (b["r"].x0 + b["r"].x1) / 2
    named = [b for b in boxes
             if re.search(r"[A-Za-zÄÖÜäöü]", b["name"])
             and len(b["name"]) >= 4 and not FRAGMENT.match(b["name"])]
    if len(named) < 3:
        return None

    # ── percentage labels ──
    labels = []
    for blk in page.get_text("blocks"):
        t = blk[4].strip()
        if re.sub(PCT + r"|[,\s8932150]", "", t):     # substantial text -> a box, not a label
            continue
        ms = re.findall(PCT, t)
        if not ms:
            continue
        own = next((m for m in ms if not m.startswith("(")), ms[0])
        pref = next((m for m in ms if m.startswith("(")), None)
        labels.append({"x": (blk[0] + blk[2]) / 2, "y": (blk[1] + blk[3]) / 2, "x0": blk[0], "x1": blk[2],
                       "own": own.strip("()%"), "pref": pref.strip("()%") if pref else None})

    # ── edges: anchor each label between nearest box above/below ──
    def pick(lb, direction):
        best, bd = None, 1e9
        for b in named:
            ov = max(0, min(lb["x1"], b["r"].x1) - max(lb["x0"], b["r"].x0))
            dx = 0 if ov > 0 else abs(b["cx"] - lb["x"]) - b["r"].width / 2
            if dx > xtol:
                continue
            dy = (lb["y"] - b["r"].y1) if direction == "up" else (b["r"].y0 - lb["y"])
            if dy < -4:
                continue
            score = max(dy, 0) + max(dx, 0) * 1.2
            if score < bd:
                best, bd = b, score
        return best

    edges = []
    seen = set()
    for lb in labels:
        par, chi = pick(lb, "up"), pick(lb, "down")
        if not par or not chi or par["id"] == chi["id"]:
            continue
        key = (par["name"].lower(), chi["name"].lower())
        if key in seen or par["name"].lower() == chi["name"].lower():
            continue
        seen.add(key)
        edges.append({"parent": par["name"], "child": chi["name"],
                      "pct": float(lb["own"].replace(",", ".")) if lb["own"] else 0.0,
                      "kind": "shares",
                      "mechanism": f"Vorzugskapital {lb['pref']}%" if lb["pref"] else ""})

    # entities deduped by name; kind from the legal form first (a person has
    # none), else from the box colour
    from .spa import _kind as legal_kind
    ents, seen_n = [], set()
    for b in named:
        k = b["name"].lower()
        if k in seen_n:
            continue
        seen_n.add(k)
        kind = legal_kind(b["name"])
        if kind != "individual" and b["cls"] == "green":
            kind = "operating"
        ents.append({"name": b["name"], "kind": kind, "role": "other"})
    return {"entities": ents, "edges": edges, "ubos": [], "target": None,
            "_draft": True, "_labels": len(labels)}
