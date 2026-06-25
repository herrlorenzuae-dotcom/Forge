#!/usr/bin/env python3
"""Extract a *vector* structure chart (PDF) into a StructureSnapshot JSON —
fully local, nothing is sent anywhere.

Why local: a vector PDF carries its names, percentages and geometry as real
data, so the whole chart can be read on-machine. That keeps a confidential
group chart off any model API (unlike a flat image, which the app's vision
import cannot mask). The result is a *draft* — edge inference is best-effort
and meant to be checked in the app's reconcile/review screen, not trusted blind.

Method
  boxes  : drawing bounding-boxes (filled rects OR 3–4 line borders) of
           plausible size, deduped; text assigned by center-containment;
           colour-classified (green=operating, grey=individual, else holding).
  labels : "x,xx% (y,yy%)" blocks — the second, parenthesised figure is the
           Vorzugskapital (preferred-capital) share, kept in `mechanism`.
  edges  : each label is anchored between the nearest box above (parent) and
           below (child), x-overlapping. One label -> one edge.
  outputs: <out>.json (snapshot), <out>.entities.csv, <out>.overlay.png
           (boxes + parent→label→child links, for visual verification).

Usage:  python3 tools/extract_pdf_chart.py CHART.pdf -o /path/out [--xtol 40]
Requires: pip install pymupdf
"""
import argparse, re, json, csv, math, unicodedata, sys
from collections import Counter

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF is required: pip install pymupdf")

PCT = r"\(?\d{1,3},\d{2}%?\)?"


def classify(fill):
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


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def slug(s):
    a = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", a).strip("-") or "e"


KIND = {"green": "operating", "grey": "individual", "white": "holding", "blue": "holding", "red": "holding"}


def extract(pdf_path, xtol=40):
    doc = fitz.open(pdf_path)
    page = doc[0]

    # ── boxes ────────────────────────────────────────────────────────────────
    boxes = []
    for d in page.get_drawings():
        kinds = Counter(it[0] for it in d["items"])
        r = d["rect"]
        boxlike = 30 < r.width < 470 and 12 < r.height < 240
        if (kinds.get("re") and boxlike) or (
            kinds.get("l", 0) >= 3 and not kinds.get("re") and boxlike and r.width >= r.height
        ):
            boxes.append({"r": fitz.Rect(r), "cls": classify(d.get("fill"))})
    boxes.sort(key=lambda b: (0 if b["cls"] in ("green", "blue", "red") else 1))
    deduped = []
    for b in boxes:
        cx, cy = (b["r"].x0 + b["r"].x1) / 2, (b["r"].y0 + b["r"].y1) / 2
        if any(abs(cx - (o["r"].x0 + o["r"].x1) / 2) < 5 and abs(cy - (o["r"].y0 + o["r"].y1) / 2) < 5 for o in deduped):
            continue
        deduped.append(b)
    boxes = deduped

    words = page.get_text("words")

    def name_in(r):
        ws = [w for w in words if r.x0 - 1 <= (w[0] + w[2]) / 2 <= r.x1 + 1 and r.y0 - 1 <= (w[1] + w[3]) / 2 <= r.y1 + 1]
        ws.sort(key=lambda w: (round(w[1] / 3), w[0]))
        return " ".join(w[4] for w in ws if not re.fullmatch(PCT + r"|[,]", w[4])).strip()

    for i, b in enumerate(boxes):
        b["id"] = i
        b["name"] = name_in(b["r"])
        b["cx"] = (b["r"].x0 + b["r"].x1) / 2
    named = [b for b in boxes if re.search(r"[A-Za-zÄÖÜäöü]", b["name"])]

    # ── labels ───────────────────────────────────────────────────────────────
    labels = []
    for b in page.get_text("blocks"):
        t = b[4].strip()
        if re.sub(PCT + r"|[,\s8932150]", "", t):  # has substantial non-number text -> a box, skip
            continue
        ms = re.findall(PCT, t)
        if not ms:
            continue
        own = next((m for m in ms if not m.startswith("(")), ms[0])
        pref = next((m for m in ms if m.startswith("(")), None)
        labels.append({"x": (b[0] + b[2]) / 2, "y": (b[1] + b[3]) / 2, "x0": b[0], "x1": b[2],
                       "own": own.strip("()%"), "pref": pref.strip("()%") if pref else None})

    # ── edges: anchor each label between nearest box above/below ──────────────
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
    for lb in labels:
        par, chi = pick(lb, "up"), pick(lb, "down")
        if par and chi and par["id"] != chi["id"]:
            edges.append({"parent": par, "child": chi, "lb": lb})

    return doc, page, named, labels, edges


def build_snapshot(named, edges, source):
    refmap = {b["id"]: f"{slug(norm(b['name']))}-{b['id']}" for b in named}
    snap = {
        "entities": [{"ref": refmap[b["id"]], "name": norm(b["name"]), "kind": KIND.get(b["cls"], "holding"),
                      "role": "other", "jurisdiction": "", "registration_no": "",
                      "notes": f"chart import [{b['cls']}]"} for b in named],
        "edges": [], "ubos": [], "attributes": [],
        "_meta": {"source": source, "boxes": len(named), "edges": len(edges),
                  "note": "DRAFT — verify edges in the reconcile/review screen"},
    }
    for e in edges:
        lb = e["lb"]
        edge = {"parentRef": refmap[e["parent"]["id"]], "childRef": refmap[e["child"]["id"]],
                "pct": float(lb["own"].replace(",", ".")) if lb["own"] else 0.0, "kind": "shares"}
        if lb["pref"]:
            edge["mechanism"] = f"Vorzugskapital {lb['pref']}%"
        snap["edges"].append(edge)
    return snap


def write_overlay(page, named, edges, path):
    sh = page.new_shape()
    for b in named:
        sh.draw_rect(b["r"])
    sh.finish(color=(0, 0, 1), width=1)
    sh.commit()
    sh2 = page.new_shape()
    for e in edges:
        L = fitz.Point(e["lb"]["x"], e["lb"]["y"])
        sh2.draw_line(fitz.Point(e["parent"]["cx"], e["parent"]["r"].y1), L)
        sh2.draw_line(L, fitz.Point(e["child"]["cx"], e["child"]["r"].y0))
    sh2.finish(color=(0, 0.6, 0), width=1.2)
    sh2.commit()
    page.get_pixmap(matrix=fitz.Matrix(0.6, 0.6)).save(path)


def main():
    ap = argparse.ArgumentParser(description="Extract a vector PDF structure chart into a StructureSnapshot (local).")
    ap.add_argument("pdf")
    ap.add_argument("-o", "--out", default="chart", help="output basename (writes .json/.entities.csv/.overlay.png)")
    ap.add_argument("--xtol", type=float, default=40, help="horizontal tolerance (pt) for label↔box anchoring")
    args = ap.parse_args()

    doc, page, named, labels, edges = extract(args.pdf, args.xtol)
    snap = build_snapshot(named, edges, source=args.pdf.split("/")[-1])
    json.dump(snap, open(f"{args.out}.json", "w"), ensure_ascii=False, indent=2)
    with open(f"{args.out}.entities.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["name", "kind", "class"])
        for b in named:
            w.writerow([norm(b["name"]), KIND.get(b["cls"], "holding"), b["cls"]])
    write_overlay(page, named, edges, f"{args.out}.overlay.png")
    pref = sum(1 for e in snap["edges"] if e.get("mechanism"))
    print(f"entities: {len(named)}  edges: {len(edges)}/{len(labels)} labels  ({pref} with Vorzugskapital)")
    print(f"wrote {args.out}.json, {args.out}.entities.csv, {args.out}.overlay.png")
    print("NOTE: edges are a draft — verify in the reconcile/review screen before applying.")


if __name__ == "__main__":
    main()
