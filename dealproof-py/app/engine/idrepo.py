"""ID-document repository (Ausweis-Repository) — tenant-wide.

The client keeps the key identification documents (passport / Personalausweis)
of its beneficial owners and managing directors on file ONCE; every project can
then attach them to the outgoing deliverable as a clean annex, selected per
person with one click. Stored inside the tenant's own database, so the backup
carries them and other tenants never see them.
"""
from ..db import db, gen_id, rows, one

ROLES = [
    ("ubo", "UBO"),
    ("director", "Managing director (Geschäftsführer)"),
    ("signatory", "Authorized signatory"),
    ("other", "Other"),
]
ROLE_LABEL = dict(ROLES)


def add(person: str, role: str, filename: str, content: bytes, note: str = "") -> None:
    with db() as con:
        con.execute("INSERT INTO id_documents (id, person, role, filename, content, note) VALUES (?,?,?,?,?,?)",
                    (gen_id("iddoc"), person.strip(), role if role in ROLE_LABEL else "other",
                     filename, content, note.strip()))


def list_all() -> list:
    with db() as con:
        docs = rows(con, """SELECT id, person, role, filename, note, uploaded_at, length(content) size
                            FROM id_documents ORDER BY role, person""")
    for d in docs:
        d["role_label"] = ROLE_LABEL.get(d["role"], d["role"])
    return docs


def get(doc_id: str):
    with db() as con:
        return one(con, "SELECT * FROM id_documents WHERE id=?", (doc_id,))


def delete(doc_id: str) -> None:
    with db() as con:
        con.execute("DELETE FROM id_documents WHERE id=?", (doc_id,))


def _matches(person: str, name: str) -> bool:
    pt = {t for t in person.lower().replace(",", " ").split() if len(t) > 1 and not t.endswith(".")}
    nt = {t for t in name.lower().replace(",", " ").split() if len(t) > 1 and not t.endswith(".")}
    return bool(pt and nt and (pt <= nt or nt <= pt))


def suggest_for_project(project_id: str) -> set:
    """IDs whose person appears in the project — as recorded UBO or in a
    Directors attribute — so the deliver page can pre-select them."""
    with db() as con:
        ubos = [r["name"] for r in con.execute("""SELECT en.name name FROM ubos u
            JOIN entities en ON en.id=u.entity_id WHERE u.client_id=?""", (project_id,))]
        directors = [r["value"] for r in con.execute("""SELECT a.value value FROM entity_attributes a
            JOIN entities en ON en.id=a.entity_id
            WHERE en.client_id=? AND a.key LIKE '%irector%'""", (project_id,))]
    out = set()
    for d in list_all():
        if any(_matches(d["person"], n) for n in ubos) or \
           any(d["person"].lower() in v.lower() or _matches(d["person"], v) for v in directors):
            out.add(d["id"])
    return out


IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff")


def annex_pdf(doc_ids: list, project_name: str, lead_pdf: bytes = None) -> bytes:
    """The ID annex as one PDF: a cover sheet listing every included document,
    then each document (PDF pages taken over 1:1, images placed full-page).
    With lead_pdf, the annex is appended to that document (the completed
    questionnaire) so one file goes out."""
    import fitz
    from datetime import date
    docs = [get(i) for i in doc_ids]
    docs = [d for d in docs if d]
    out = fitz.open()
    page = out.new_page()
    y = 92
    page.insert_text((56, 64), "Annex — Identification documents", fontsize=17, fontname="hebo", color=(0.07, 0.2, 0.3))
    page.insert_text((56, y), f"{project_name} · {date.today().strftime('%d.%m.%Y')}", fontsize=10.5, color=(0.35, 0.35, 0.35))
    y += 30
    for i, d in enumerate(docs, 1):
        page.insert_text((56, y), f"Annex {i}:  {d['person']} — {ROLE_LABEL.get(d['role'], d['role'])}  ({d['filename']})",
                         fontsize=11)
        y += 18
    for i, d in enumerate(docs, 1):
        name = (d["filename"] or "").lower()
        content = d["content"]
        cap = out.new_page()
        cap.insert_text((56, 64), f"Annex {i} — {d['person']}", fontsize=14, fontname="hebo", color=(0.07, 0.2, 0.3))
        cap.insert_text((56, 86), f"{ROLE_LABEL.get(d['role'], d['role'])} · {d['filename']}", fontsize=10.5, color=(0.35, 0.35, 0.35))
        if name.endswith(IMAGE_EXT):
            cap.insert_image(fitz.Rect(56, 120, cap.rect.width - 56, cap.rect.height - 72), stream=content, keep_proportion=True)
        else:
            try:
                src = fitz.open(stream=content, filetype="pdf")
                out.insert_pdf(src)
            except Exception:
                cap.insert_text((56, 130), "(file format could not be embedded — deliver the original file alongside)",
                                fontsize=10, color=(0.6, 0.2, 0.2))
    if lead_pdf:
        merged = fitz.open(stream=lead_pdf, filetype="pdf")
        merged.insert_pdf(out)
        return merged.tobytes()
    return out.tobytes()
