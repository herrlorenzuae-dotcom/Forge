"""DealProof — FastAPI app. Project-centric flow:
landing (projects) → new project (name) → upload the KYC document → analysis
report (where each answer can come from) → structure / requests."""
import os
from fastapi import FastAPI, Request, Form, UploadFile, File, Query
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import config
from .db import init_db, db, rows, one
from .engine import projects as proj
from .engine import spa as spa_engine
from .engine import transparency
from .engine import export as exporter
from .engine.structure import get_structure
from .engine.orgchart import build_orgchart, render_svg, default_subject
from .engine.coverage import build_coverage
from .engine.analysis import build_analysis
from .engine import requests as reqs
from .engine import mapping
from .engine import templatefill
from .engine.brain import brain_stats, get_brain_options, learn_from_document

BASE = os.path.dirname(__file__)
app = FastAPI(title="DealProof")
app.mount("/static", StaticFiles(directory=os.path.join(BASE, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE, "templates"))


@app.on_event("startup")
def _startup():
    init_db()
    from .demo import seed_demo
    seed_demo()  # one clearly-labelled demo project (idempotent)


def ctx(request, **kw):
    return {"request": request, "has_key": config.HAS_KEY, **kw}


def extract_text(filename: str, data: bytes) -> str:
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        try:
            import fitz
            doc = fitz.open(stream=data, filetype="pdf")
            return "\n".join(p.get_text() for p in doc)
        except Exception:
            return ""
    if name.endswith(".docx"):
        try:
            from io import BytesIO
            from docx import Document
            d = Document(BytesIO(data))
            parts = [p.text for p in d.paragraphs]
            for t in d.tables:
                for r in t.rows:
                    parts.append("\t".join(c.text for c in r.cells))
            return "\n".join(parts)
        except Exception:
            return ""
    try:
        return data.decode("utf-8")
    except Exception:
        return data.decode("latin-1", "ignore")


def one_qn(qid):
    with db() as con:
        return one(con, "SELECT * FROM questionnaires WHERE id=?", (qid,))


def rows_questions(qid):
    with db() as con:
        qs = rows(con, "SELECT * FROM questions WHERE questionnaire_id=? ORDER BY position", (qid,))
        ans = {a["question_id"]: a for a in rows(con, "SELECT a.* FROM answers a JOIN questions q ON q.id=a.question_id WHERE q.questionnaire_id=?", (qid,))}
    for q in qs:
        q["answer"] = ans.get(q["id"])
        q["options"] = get_brain_options(q["prompt"])
    return qs


# ── Landing / projects ──
@app.get("/", response_class=HTMLResponse)
def landing(request: Request):
    from .engine import connectors
    return templates.TemplateResponse(request, "landing.html", ctx(request, active="projects",
        projects=proj.list_projects(), connectors=connectors.status(), model=config.MODEL))


@app.post("/projects")
def create_project(name: str = Form(...), subject_company: str = Form(""),
                   register_no: str = Form(""), portfolio_company: str = Form("")):
    pid = proj.create_project(name, subject_company, register_no, portfolio_company)
    return RedirectResponse(f"/projects/{pid}", status_code=303)


@app.post("/projects/{pid}/edit")
def edit_project(pid: str, name: str = Form(""), subject_company: str = Form(""),
                 register_no: str = Form(""), portfolio_company: str = Form("")):
    proj.update_project(pid, name=name, subject_company=subject_company,
                        register_no=register_no, portfolio_company=portfolio_company)
    return RedirectResponse(f"/projects/{pid}", status_code=303)


@app.get("/projects/{pid}", response_class=HTMLResponse)
def project_page(request: Request, pid: str):
    project = proj.get_project(pid)
    if not project:
        return RedirectResponse("/")
    return templates.TemplateResponse(request, "project.html",
        ctx(request, active="project", project=project, documents=proj.list_documents(pid)))


@app.post("/projects/{pid}/documents")
async def upload_document(pid: str, file: UploadFile = File(None), pasted: str = Form(""), requester: str = Form("")):
    text, filename, content = pasted, "pasted.txt", b""
    if file is not None and file.filename:
        content = await file.read()
        text = extract_text(file.filename, content)
        filename = file.filename
    if not text.strip():
        return RedirectResponse(f"/projects/{pid}", status_code=303)
    res = proj.add_document(pid, filename, text, requester, content=content)
    return RedirectResponse(f"/projects/{pid}/analysis/{res['questionnaire_id']}", status_code=303)


# ── Analysis ──
@app.get("/projects/{pid}/analysis/{qid}", response_class=HTMLResponse)
def analysis_page(request: Request, pid: str, qid: str):
    return templates.TemplateResponse(request, "analysis.html", ctx(request,
        active="project", project=proj.get_project(pid), qn=one_qn(qid), questions=rows_questions(qid),
        analysis=build_analysis(qid), coverage=build_coverage(qid), fillable=templatefill.is_fillable(qid),
        requests=reqs.list_requests(pid), request_text=reqs.render_request_list(pid)))


@app.get("/projects/{pid}/analysis/{qid}/export.docx")
def export_qn_docx(pid: str, qid: str):
    return Response(exporter.questionnaire_docx(qid),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="questionnaire-{qid}.docx"'})


@app.get("/projects/{pid}/analysis/{qid}/export.pdf")
def export_qn_pdf(pid: str, qid: str):
    return Response(exporter.questionnaire_pdf(qid), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="questionnaire-{qid}.pdf"'})


@app.get("/projects/{pid}/analysis/{qid}/export.xlsx")
def export_qn_xlsx(pid: str, qid: str):
    return Response(exporter.questionnaire_xlsx(qid),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="questionnaire-{qid}.xlsx"'})


@app.get("/projects/{pid}/analysis/{qid}/fill")
def fill_original_doc(pid: str, qid: str):
    res = templatefill.fill_original(qid)
    if not res:
        return RedirectResponse(f"/projects/{pid}/analysis/{qid}", status_code=303)
    body, mt, fname = res
    return Response(body, media_type=mt, headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@app.post("/projects/{pid}/analysis/{qid}/answer")
def do_answer_all(pid: str, qid: str):
    mapping.answer_all(qid)
    return RedirectResponse(f"/projects/{pid}/analysis/{qid}", status_code=303)


@app.post("/projects/{pid}/analysis/{qid}/requests")
def do_requests(pid: str, qid: str):
    reqs.generate_requests(qid)
    return RedirectResponse(f"/projects/{pid}/analysis/{qid}", status_code=303)


@app.post("/projects/{pid}/analysis/{qid}/finalize")
def do_finalize(pid: str, qid: str):
    mapping.finalize(qid)
    return RedirectResponse(f"/projects/{pid}/analysis/{qid}", status_code=303)


@app.post("/questions/{question_id}/answer")
def do_answer_one(question_id: str, pid: str = Form(...), qid: str = Form(...)):
    mapping.answer_question(question_id)
    return RedirectResponse(f"/projects/{pid}/analysis/{qid}", status_code=303)


@app.post("/questions/{question_id}/set")
def do_set(question_id: str, value: str = Form(""), pid: str = Form(...), qid: str = Form(...)):
    mapping.set_answer(question_id, value)
    return RedirectResponse(f"/projects/{pid}/analysis/{qid}", status_code=303)


@app.post("/requests/{req_id}")
def do_update_request(req_id: str, status: str = Form(...), pid: str = Form(...), qid: str = Form(...)):
    reqs.update_request(req_id, status=status)
    return RedirectResponse(f"/projects/{pid}/analysis/{qid}", status_code=303)


# ── Structure ──
@app.get("/projects/{pid}/structure", response_class=HTMLResponse)
def structure_page(request: Request, pid: str, view: str = Query("excerpt"), subject: str = Query(None)):
    chart = build_orgchart(pid)
    excerpt = view == "excerpt"
    subj = subject or default_subject(chart["nodes"], chart["edges"])
    return templates.TemplateResponse(request, "structure.html", ctx(request,
        active="structure", project=proj.get_project(pid), structure=get_structure(pid),
        chart=chart, chart_svg=render_svg(pid, subject=subj, excerpt=excerpt),
        view=view, subject=subj, spec=spa_engine.structure_to_spec(pid)))


@app.post("/projects/{pid}/structure")
async def ingest_structure(pid: str, file: UploadFile = File(None), pasted: str = Form(""), replace: str = Form("")):
    text = pasted
    if file is not None and file.filename:
        data = await file.read()
        text = extract_text(file.filename, data)
    if text.strip():
        # An edited spec (manual correction) is the deterministic format — parse it
        # directly; an uploaded SPA goes through the (model-assisted) extractor.
        if replace == "spec":
            spec = spa_engine.parse_structure_spec(text)
        else:
            spec = spa_engine.extract_from_spa(text, pid)
        spa_engine.apply_structure(pid, spec)
        proj.touch(pid)
    return RedirectResponse(f"/projects/{pid}/structure?view={'full' if replace=='spec' else 'excerpt'}", status_code=303)


@app.post("/projects/{pid}/ubos")
async def import_ubos(pid: str, file: UploadFile = File(None), pasted: str = Form("")):
    text = pasted
    if file is not None and file.filename:
        data = await file.read()
        text = extract_text(file.filename, data)
    if text.strip():
        transparency.import_extract(pid, text)
        proj.touch(pid)
    return RedirectResponse(f"/projects/{pid}/structure?view=excerpt", status_code=303)


# ── Structure / chart export ──
@app.get("/projects/{pid}/structure.svg")
def export_svg(pid: str, view: str = Query("full")):
    body = exporter.chart_svg(pid, excerpt=view == "excerpt")
    return Response(body, media_type="image/svg+xml",
                    headers={"Content-Disposition": f'attachment; filename="structure-{pid}.svg"'})


@app.get("/projects/{pid}/structure.png")
def export_png(pid: str, view: str = Query("full")):
    body = exporter.chart_png(pid, excerpt=view == "excerpt")
    return Response(body, media_type="image/png",
                    headers={"Content-Disposition": f'attachment; filename="structure-{pid}.png"'})


@app.get("/projects/{pid}/structure.pdf")
def export_structure_pdf(pid: str, view: str = Query("full")):
    body = exporter.chart_pdf(pid, excerpt=view == "excerpt")
    return Response(body, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="structure-{pid}.pdf"'})


@app.get("/projects/{pid}/structure.xlsx")
def export_structure_xlsx(pid: str):
    body = exporter.structure_xlsx(pid)
    return Response(body, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="structure-{pid}.xlsx"'})


# ── Brain (cross-project memory) ──
@app.get("/brain", response_class=HTMLResponse)
def brain_page(request: Request, learned: int = Query(None), total: int = Query(None)):
    return templates.TemplateResponse(request, "brain.html", ctx(request, active="brain",
        entries=brain_stats(), learned=learned, total=total))


@app.post("/brain/learn")
async def brain_learn(file: UploadFile = File(None)):
    if file is not None and file.filename:
        data = await file.read()
        res = learn_from_document(file.filename, data, extract_text(file.filename, data))
        return RedirectResponse(f"/brain?learned={res['learned']}&total={res['total']}", status_code=303)
    return RedirectResponse("/brain", status_code=303)


# ── JSON API ──
@app.get("/api/health")
def health():
    from .engine import connectors
    return {"ok": True,
            "anthropic": {"enabled": config.HAS_KEY, "model": config.MODEL},
            "connectors": connectors.status()}


@app.get("/api/projects/{pid}/analysis/{qid}")
def api_analysis(pid: str, qid: str):
    return build_analysis(qid)


# Lets you start the app with plain `python -m app.main` (or `python app/main.py`).
# Port via KYC_PORT env var, default 8000.
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("KYC_PORT", "3100")), reload=True)
