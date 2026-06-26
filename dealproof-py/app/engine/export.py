"""Export the org chart / structure: SVG, PNG, PDF (rendered from the SVG via
PyMuPDF) and Excel (structure tables, for review/correction)."""
from io import BytesIO
from .orgchart import render_svg
from .structure import get_structure


def chart_svg(project_id: str, excerpt: bool = False) -> str:
    inner = render_svg(project_id, excerpt=excerpt)
    if not inner.lstrip().startswith("<svg"):
        inner = f'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60"><text x="8" y="32">No structure</text></svg>'
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + inner


def chart_png(project_id: str, excerpt: bool = False) -> bytes:
    import fitz
    doc = fitz.open(stream=chart_svg(project_id, excerpt).encode("utf-8"), filetype="svg")
    return doc[0].get_pixmap(matrix=fitz.Matrix(2, 2)).tobytes("png")


def chart_pdf(project_id: str, excerpt: bool = False) -> bytes:
    import fitz
    doc = fitz.open(stream=chart_svg(project_id, excerpt).encode("utf-8"), filetype="svg")
    return doc.convert_to_pdf()


def structure_xlsx(project_id: str) -> bytes:
    from openpyxl import Workbook
    s = get_structure(project_id)
    name = {e["id"]: e["name"] for e in s["entities"]}
    wb = Workbook()
    e = wb.active
    e.title = "Entities"
    e.append(["Name", "Kind", "Role", "Jurisdiction", "Registration no.", "Incorporation"])
    for x in s["entities"]:
        e.append([x["name"], x["kind"], x["role"], x["jurisdiction"], x["registration_no"], x["incorporation_date"]])
    r = wb.create_sheet("Relationships")
    r.append(["Parent", "Child", "Percent", "Kind", "Mechanism"])
    for x in s["edges"]:
        r.append([name.get(x["parent_id"], "?"), name.get(x["child_id"], "?"), x["pct"], x["kind"], x["mechanism"]])
    u = wb.create_sheet("UBOs")
    u.append(["Entity", "Basis", "Percent", "PEP", "Residence"])
    for x in s["ubos"]:
        u.append([x["entity_name"], x["basis"], x["pct"], "yes" if x["pep"] else "no", x["residence"]])
    bio = BytesIO()
    wb.save(bio)
    return bio.getvalue()
