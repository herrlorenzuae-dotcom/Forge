"""Legal grounding for beneficial-owner (UBO) statements, per the German
Transparenzregister FAQ (BVA):

  § 3 Abs. 1, 2 GwG — a natural person is beneficial owner who directly or
  indirectly (i) holds MORE THAN 25% of the capital, (ii) controls more than
  25% of the voting rights, or (iii) exercises control in a comparable /
  other way (e.g. as general partner (Komplementär), via veto rights, or by
  dominating the parent within the meaning of § 3 Abs. 2 S. 2–4 GwG in
  conjunction with § 290 Abs. 2–4 HGB).

  § 3 Abs. 2 S. 5 GwG — if no actual beneficial owner can be determined even
  after comprehensive checks, the LEGAL REPRESENTATIVE / managing partner
  counts as the FICTITIOUS beneficial owner
  (reported as "Funktion des gesetzlichen Vertreters …", § 19 Abs. 3 Nr. 1c GwG).

The register's "Art des wirtschaftlichen Interesses" wording maps onto these
codes; the tool shows the short label + legal reference everywhere a UBO is
named (chart, panel, exports), so a bank can follow WHY someone is the UBO."""
import re

# code -> presentation + legal grounding
CATALOG = {
    "capital": {
        "basis": "ownership",
        "short": "Kapitalanteile > 25 %",
        "ref": "§ 3 Abs. 2 S. 1 GwG; § 19 Abs. 3 Nr. 1a GwG",
        "explain": "Holds more than 25% of the capital (directly or indirectly).",
    },
    "voting": {
        "basis": "voting",
        "short": "Stimmrechte > 25 %",
        "ref": "§ 3 Abs. 2 S. 1 GwG; § 19 Abs. 3 Nr. 1b GwG",
        "explain": "Controls more than 25% of the voting rights.",
    },
    "control": {
        "basis": "control",
        "short": "Kontrolle auf sonstige Weise",
        "ref": "§ 3 Abs. 2 S. 2–4 GwG i. V. m. § 290 Abs. 2–4 HGB",
        "explain": "Exercises control in another way — e.g. as general partner "
                   "(Komplementär), via veto rights, or by dominating the parent entity.",
    },
    "fictitious": {
        "basis": "control",
        "short": "Fiktiver wirtschaftlich Berechtigter (gesetzlicher Vertreter)",
        "ref": "§ 3 Abs. 2 S. 5 GwG; § 19 Abs. 3 Nr. 1c GwG",
        "explain": "No actual beneficial owner could be determined, so the legal "
                   "representative / managing partner counts as beneficial owner.",
    },
}

PCT_BAND = re.compile(r"(\d{1,3}(?:[.,]\d+)?)\s*%?\s*(?:bis|[-–]|to)\s*(?:einschließlich\s*)?(\d{1,3})\s*%", re.I)
PCT_ONE = re.compile(r"(\d{1,3}(?:[.,]\d+)?)\s*%")


def classify_extent(art: str, umfang: str = "") -> dict:
    """Map the register's 'Art/Umfang des wirtschaftlichen Interesses' onto the
    legal catalogue. Returns {code, basis, pct, short, ref, explain, verbatim}."""
    art = (art or "").strip()
    umfang = (umfang or "").strip()
    t = f"{art} {umfang}".lower()

    if re.search(r"gesetzlichen?\s+vertreter|geschäftsführenden?\s+gesellschafter|§\s*19\s*abs\.?\s*3\s*nr\.?\s*1c|§\s*3\s*abs\.?\s*2\s*s(?:atz|\.)\s*5", t):
        code = "fictitious"
    elif re.search(r"stimmrecht|§\s*19\s*abs\.?\s*3\s*nr\.?\s*1b", t):
        code = "voting"
    elif re.search(r"sonstige\s+weise|kontrolle|beherrsch|vetorecht|komplement", t):
        code = "control"
    elif re.search(r"kapitalanteil|beteiligung|§\s*19\s*abs\.?\s*3\s*nr\.?\s*1a", t):
        code = "capital"
    else:
        code = "capital" if PCT_ONE.search(t) else "control"

    pct = 0.0
    band = PCT_BAND.search(t)
    if band:
        pct = float(band.group(1).replace(",", "."))
    else:
        m = PCT_ONE.search(t)
        if m and code in ("capital", "voting"):
            pct = float(m.group(1).replace(",", "."))

    cat = CATALOG[code]
    verbatim = " — ".join(x for x in (art, umfang) if x)
    return {"code": code, "basis": cat["basis"] if code != "voting" else "ownership",
            "pct": pct, "short": cat["short"], "ref": cat["ref"],
            "explain": cat["explain"], "verbatim": verbatim,
            "note": f"{cat['short']} ({cat['ref']})" + (f" — „{verbatim}“" if verbatim else "")}
