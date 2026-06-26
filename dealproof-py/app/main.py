"""DealProof — FastAPI app. Project-centric flow:
landing (projects) → new project (name) → upload the KYC document → analysis
report (where each answer can come from) → structure / requests."""
import os
from fastapi import FastAPI, Request, Form, UploadFile, File
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import config
from .db import init_db, db, rows, one
from .engine import projects as proj
from .engine.structure import get_structure
from .engine.orgchart import build_orgchart, render_svg
from .engine.coverage import build_coverage
from .engine.analysis import build_analysis
from .engine import requests as reqs
from .engine import mapping
from .engine.brain import brain_stats, get_brain_options

BASE = os.path.dirname(__file__)
app = FastAPI(title="DealProof")
app.mount("/static", StaticFiles(directory=os.path.join(BASE, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE, "templates"))


@app.on_event("startup")
def _startup():
    init_db()  # no demo seed — projects are created by the user


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
    return templates.TemplateResponse(request, "landing.html", ctx(request, active="projects", projects=proj.list_projects()))


@app.post("/projects")
def create_project(name: str = Form(...)):
    pid = proj.create_project(name)
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
    text, filename = pasted, "pasted.txt"
    if file is not None and file.filename:
        data = await file.read()
        text = extract_text(file.filename, data)
        filename = file.filename
    if not text.strip():
        return RedirectResponse(f"/projects/{pid}", status_code=303)
    res = proj.add_document(pid, filename, text, requester)
    return RedirectResponse(f"/projects/{pid}/analysis/{res['questionnaire_id']}", status_code=303)


# ── Analysis ──
@app.get("/projects/{pid}/analysis/{qid}", response_class=HTMLResponse)
def analysis_page(request: Request, pid: str, qid: str):
    return templates.TemplateResponse(request, "analysis.html", ctx(request,
        active="project", project=proj.get_project(pid), qn=one_qn(qid), questions=rows_questions(qid),
        analysis=build_analysis(qid), coverage=build_coverage(qid),
        requests=reqs.list_requests(pid), request_text=reqs.render_request_list(pid)))


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
def structure_page(request: Request, pid: str):
    return templates.TemplateResponse(request, "structure.html", ctx(request,
        active="structure", project=proj.get_project(pid), structure=get_structure(pid),
        chart=build_orgchart(pid), chart_svg=render_svg(pid)))


# ── Brain (cross-project memory) ──
@app.get("/brain", response_class=HTMLResponse)
def brain_page(request: Request):
    return templates.TemplateResponse(request, "brain.html", ctx(request, active="brain", entries=brain_stats()))


# ── JSON API ──
@app.get("/api/health")
def health():
    return {"ok": True, "model": config.MODEL, "anthropicKey": config.HAS_KEY}


@app.get("/api/projects/{pid}/analysis/{qid}")
def api_analysis(pid: str, qid: str):
    return build_analysis(qid)
