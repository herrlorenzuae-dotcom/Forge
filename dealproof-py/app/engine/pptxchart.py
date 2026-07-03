"""Rebuild a structure from a PowerPoint chart (.pptx) — the format structure
charts are actually drawn in. Fully local, no model involved.

PPTX is richer than PDF: shapes carry stable ids and connectors reference
their start/end shape ids explicitly (a:stCxn/a:endCxn). Where a deck's
connectors are free-floating lines instead, the endpoints are matched to the
nearest box geometrically. Boxes often carry the register number and the
managing directors in their text — both are captured onto the entity.

  entities   : text-bearing boxes (title/footer/page-number placeholders and
               pure label shapes are skipped)
  edges      : connectors; direction = upper box is the parent
  percentages: standalone "53,50%" label shapes assigned to the nearest
               connector midpoint; "GP" labels mark a connector as control
"""
import re
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO

NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main",
      "p": "http://schemas.openxmlformats.org/presentationml/2006/main"}
PCT_RE = re.compile(r"^\s*\d{1,3}(?:[.,]\d+)?\s*%\s*$")
REG_RE = re.compile(r"\bHR[AB]\s*\d+\b[^\n]*", re.I)
SKIP_TEXT = re.compile(r"©|strictly private|structure\s+chart|^\d{1,2}\.\d{1,2}\.\d{4}$|^\d{1,2}$", re.I)
CTRL_LABEL = re.compile(r"(?i)^(GP|General\s+Partner|Komplementär(in)?)$")
INFO_LABEL = re.compile(r"(?i)^(MLP|LP|Limited\s+Partner|Kommanditist(en)?|Gesellschafter|<?\s*\d+\s*%\s*each)$")
DIR_STOP = re.compile(r"(?i)^(authori[sz]ed|jeweils|einzeln|each|alleinvertretungs)")


def _xfrm(el):
    x = el.find("./a:off", NS); e = el.find("./a:ext", NS)
    if x is None or e is None:
        return None
    return (int(x.get("x", 0)), int(x.get("y", 0)), int(e.get("cx", 0)), int(e.get("cy", 0)),
            el.get("flipH") == "1", el.get("flipV") == "1")


def _walk(parent, dx=0, dy=0, out_sp=None, out_cx=None):
    """Recurse shapes/connectors, accumulating group offsets (off − chOff)."""
    for child in parent:
        tag = child.tag.split("}")[1]
        if tag == "grpSp":
            g = child.find("./p:grpSpPr/a:xfrm", NS)
            gdx, gdy = dx, dy
            if g is not None:
                off = g.find("./a:off", NS); ch = g.find("./a:chOff", NS)
                if off is not None and ch is not None:
                    gdx += int(off.get("x", 0)) - int(ch.get("x", 0))
                    gdy += int(off.get("y", 0)) - int(ch.get("y", 0))
            _walk(child, gdx, gdy, out_sp, out_cx)
        elif tag == "sp":
            nv = child.find("./p:nvSpPr/p:cNvPr", NS)
            ph = child.find("./p:nvSpPr/p:nvPr/p:ph", NS)
            xf = child.find("./p:spPr/a:xfrm", NS)
            box = _xfrm(xf) if xf is not None else None
            lines = []
            for para in child.findall(".//a:p", NS):
                buf = [""]
                for node in para.iter():
                    tag2 = node.tag.split("}")[1]
                    if tag2 == "br":
                        buf.append("")
                    elif tag2 == "t":
                        buf[-1] += node.text or ""
                for t in buf:
                    if t.strip():
                        lines.append(t.strip())
            out_sp.append({"id": nv.get("id") if nv is not None else None,
                           "ph": ph.get("type", "body") if ph is not None else None,
                           "box": (box[0] + dx, box[1] + dy, box[2], box[3]) if box else None,
                           "lines": lines})
        elif tag == "cxnSp":
            st = child.find(".//a:stCxn", NS); en = child.find(".//a:endCxn", NS)
            xf = child.find("./p:spPr/a:xfrm", NS)
            geom = _xfrm(xf) if xf is not None else None
            dash = child.find(".//a:ln/a:prstDash", NS)
            pts = None
            if geom:
                x, y, cx, cy, fh, fv = geom
                x += dx; y += dy
                p1 = (x + (cx if fh else 0), y + (cy if fv else 0))
                p2 = (x + (0 if fh else cx), y + (0 if fv else cy))
                pts = (p1, p2)
            out_cx.append({"st": st.get("id") if st is not None else None,
                           "en": en.get("id") if en is not None else None,
                           "pts": pts,
                           "dash": dash.get("val") if dash is not None else "solid"})


def _parse_entity_text(lines):
    """Box text → (name, registration_no, directors). Pattern seen in real
    charts: name lines, then 'HRB 272660 LC Munich', then 'Managing
    Director(s): A, B'."""
    name_parts, reg, directors, in_dir, seen_reg = [], "", [], False, False
    for ln in lines:
        if REG_RE.search(ln):
            reg = REG_RE.search(ln).group(0).strip()
            seen_reg = True
            continue
        m = re.match(r"Managing\s+Directors?\s*:?\s*(.*)$", ln, re.I)
        if m:
            in_dir = True
            if m.group(1).strip():
                directors.append(m.group(1).strip())
            continue
        if DIR_STOP.match(ln):
            continue                      # authority note — skip, stay in context
        if in_dir:
            directors.append(ln)
        elif not seen_reg:
            name_parts.append(ln)         # after the register line nothing belongs to the name
    name = re.sub(r"\s+", " ", " ".join(name_parts)).strip()
    dirs = [d.strip() for part in directors for d in re.split(r",|&| und ", part) if d.strip()]
    return name, reg, dirs


def _dist(pt, box):
    x, y, cx, cy = box
    px, py = pt
    ddx = max(x - px, 0, px - (x + cx))
    ddy = max(y - py, 0, py - (y + cy))
    return (ddx ** 2 + ddy ** 2) ** 0.5


def extract_spec(data: bytes):
    """Extract the whole deck (all slides) into the structure-spec shape, or
    None if it doesn't look like a chart."""
    from .spa import _kind as legal_kind
    try:
        z = zipfile.ZipFile(BytesIO(data))
        slides = sorted(n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n))
    except Exception:
        return None
    if not slides:
        return None

    ents, edges, seen_edge = {}, [], set()
    for sname in slides:
        try:
            tree = ET.fromstring(z.read(sname))
        except Exception:
            continue
        sp_tree = tree.find(".//p:cSld/p:spTree", NS)
        if sp_tree is None:
            continue
        shapes, cxns = [], []
        _walk(sp_tree, 0, 0, shapes, cxns)

        boxes, labels = {}, []
        for s in shapes:
            if s["ph"] in ("title", "ftr", "sldNum", "dt") or not s["lines"] or not s["box"]:
                continue
            text = " ".join(s["lines"])
            if SKIP_TEXT.search(text):
                continue
            if PCT_RE.match(text) or CTRL_LABEL.match(text.strip()) or INFO_LABEL.match(text.strip()):
                labels.append({"box": s["box"], "text": text.strip()})
                continue
            name, reg, dirs = _parse_entity_text(s["lines"])
            if len(name) < 3:
                continue
            boxes[s["id"]] = {"name": name, "reg": reg, "dirs": dirs, "box": s["box"]}

        def nearest_box(pt, limit=900000):
            best, bd = None, limit
            for sid, b in boxes.items():
                d = _dist(pt, b["box"])
                if d < bd:
                    best, bd = sid, d
            return best

        def center_y(sid):
            b = boxes[sid]["box"]
            return b[1] + b[3] / 2

        slide_edges = []
        for c in cxns:
            a, b = c["st"], c["en"]
            if a not in boxes and c["pts"]:
                a = nearest_box(c["pts"][0])
            if b not in boxes and c["pts"]:
                b = nearest_box(c["pts"][1])
            if a not in boxes or b not in boxes or a == b:
                continue
            parent, child = (a, b) if center_y(a) <= center_y(b) else (b, a)
            mid = None
            if c["pts"]:
                mid = ((c["pts"][0][0] + c["pts"][1][0]) / 2, (c["pts"][0][1] + c["pts"][1][1]) / 2)
            else:
                pb, cb = boxes[parent]["box"], boxes[child]["box"]
                mid = ((pb[0] + pb[2] / 2 + cb[0] + cb[2] / 2) / 2, (pb[1] + pb[3] + cb[1]) / 2)
            slide_edges.append({"parent": parent, "child": child, "mid": mid,
                                "control": c["dash"] not in ("solid", None)})

        # percentage / GP labels → nearest connector midpoint
        for lb in labels:
            lx, ly = lb["box"][0] + lb["box"][2] / 2, lb["box"][1] + lb["box"][3] / 2
            best, bd = None, 1.6e6
            for e in slide_edges:
                d = ((e["mid"][0] - lx) ** 2 + (e["mid"][1] - ly) ** 2) ** 0.5
                if d < bd:
                    best, bd = e, d
            if not best:
                continue
            if PCT_RE.match(lb["text"]):
                best["pct"] = float(lb["text"].replace("%", "").replace(",", ".").strip())
            elif CTRL_LABEL.match(lb["text"]):
                best["control"] = True

        for e in slide_edges:
            pn, cn = boxes[e["parent"]]["name"], boxes[e["child"]]["name"]
            key = (pn.lower(), cn.lower())
            if key in seen_edge:
                continue
            seen_edge.add(key)
            edges.append({"parent": pn, "child": cn, "pct": e.get("pct", 0.0),
                          "kind": "control" if e.get("control") else "shares",
                          "mechanism": "General partner (Komplementär)" if e.get("control") else ""})

        for b in boxes.values():
            k = b["name"].lower()
            if k not in ents:
                ents[k] = {"name": b["name"], "kind": legal_kind(b["name"]), "role": "other",
                           "registration_no": b["reg"], "directors": b["dirs"]}
            elif b["reg"] and not ents[k]["registration_no"]:
                ents[k]["registration_no"] = b["reg"]

    if len(ents) < 2:
        return None
    return {"entities": list(ents.values()), "edges": edges, "ubos": [], "target": None, "_slides": len(slides)}
