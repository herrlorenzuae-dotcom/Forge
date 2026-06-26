"""DealProof — FastAPI app. Server-rendered pages (Jinja) + a small JSON API.
Runs with or without a model key (the KYC Brain answers from the corpus)."""
import os
from fastapi import FastAPI, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import config
from .db import init_db, db, rows, one
from .seed import seed, CLIENT
from .engine.structure import get_structure
from .engine.orgchart import build_orgchart, render_svg
from .engine.intake import create_questionnaire
from .engine.coverage import build_coverage
from .engine import requests as reqs
from .engine import mapping
from .engine.brain import brain_stats, get_brain_options

BASE = os.path.dirname(__file__)
app = FastAPI(title="DealProof")
app.mount("/static", StaticFiles(directory=os.path.join(BASE, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE, "templates"))

NAV = [("structure", "Structure"), ("questionnaires", "Questionnaires"), ("brain", "KYC Brain")]


@app.on_event("startup")
def _startup():
    init_db()
    seed()


def ctx(request, active, **kw):
    with db() as con:
        client = one(con, "SELECT * FROM clients WHERE id=?", (CLIENT,))
    return {"request": request, "nav": NAV, "active": active, "client": client,
            "has_key": config.HAS_KEY, **kw}


# ── Pages ──
@app.get("/", response_class=HTMLResponse)
def home():
    return RedirectResponse("/structure")


@app.get("/structure", response_class=HTMLResponse)
def structure_page(request: Request):
    s = get_structure(CLIENT)
    return templates.TemplateResponse(request, "structure.html", ctx(request, "structure",
        structure=s, chart=build_orgchart(CLIENT), chart_svg=render_svg(CLIENT)))


@app.get("/questionnaires", response_class=HTMLResponse)
def questionnaires_page(request: Request):
    with db() as con:
        qns = rows(con, """SELECT qn.*,
            (SELECT COUNT(*) FROM questions q WHERE q.questionnaire_id=qn.id) AS qcount,
            (SELECT COUNT(*) FROM questions q JOIN answers a ON a.question_id=q.id WHERE q.questionnaire_id=qn.id AND a.value<>'') AS acount
            FROM questionnaires qn WHERE qn.client_id=? ORDER BY created_at DESC""", (CLIENT,))
    return templates.TemplateResponse(request, "questionnaires.html", ctx(request, "questionnaires", qns=qns))


@app.post("/questionnaires")
def create_qn(requester: str = Form(""), title: str = Form(""), raw_text: str = Form(...)):
    qid = create_questionnaire(CLIENT, requester, title, raw_text)
    return RedirectResponse(f"/questionnaires/{qid}", status_code=303)


@app.get("/questionnaires/{qid}", response_class=HTMLResponse)
def questionnaire_detail(request: Request, qid: str):
    with db() as con:
        qn = one(con, "SELECT * FROM questionnaires WHERE id=?", (qid,))
        qs = rows(con, "SELECT * FROM questions WHERE questionnaire_id=? ORDER BY position", (qid,))
        ans = {a["question_id"]: a for a in rows(con, "SELECT a.* FROM answers a JOIN questions q ON q.id=a.question_id WHERE q.questionnaire_id=?", (qid,))}
    for q in qs:
        q["answer"] = ans.get(q["id"])
        q["options"] = get_brain_options(q["prompt"])
    return templates.TemplateResponse(request, "questionnaire_detail.html", ctx(request, "questionnaires",
        qn=qn, questions=qs, coverage=build_coverage(qid),
        requests=reqs.list_requests(CLIENT), request_text=reqs.render_request_list(CLIENT)))


@app.post("/questionnaires/{qid}/answer")
def do_answer_all(qid: str):
    mapping.answer_all(qid)
    return RedirectResponse(f"/questionnaires/{qid}", status_code=303)


@app.post("/questionnaires/{qid}/requests")
def do_requests(qid: str):
    reqs.generate_requests(qid)
    return RedirectResponse(f"/questionnaires/{qid}", status_code=303)


@app.post("/questionnaires/{qid}/finalize")
def do_finalize(qid: str):
    mapping.finalize(qid)
    return RedirectResponse(f"/questionnaires/{qid}", status_code=303)


@app.post("/questions/{question_id}/answer")
def do_answer_one(question_id: str, qid: str = Form(...)):
    mapping.answer_question(question_id)
    return RedirectResponse(f"/questionnaires/{qid}", status_code=303)


@app.post("/questions/{question_id}/set")
def do_set(question_id: str, value: str = Form(""), qid: str = Form(...)):
    mapping.set_answer(question_id, value)
    return RedirectResponse(f"/questionnaires/{qid}", status_code=303)


@app.post("/requests/{req_id}")
def do_update_request(req_id: str, status: str = Form(...), qid: str = Form(...)):
    reqs.update_request(req_id, status=status)
    return RedirectResponse(f"/questionnaires/{qid}", status_code=303)


@app.get("/brain", response_class=HTMLResponse)
def brain_page(request: Request):
    return templates.TemplateResponse(request, "brain.html", ctx(request, "brain", entries=brain_stats()))


# ── JSON API (parity / future use) ──
@app.get("/api/health")
def health():
    return {"ok": True, "model": config.MODEL, "anthropicKey": config.HAS_KEY}


@app.get("/api/clients/{cid}/orgchart")
def api_orgchart(cid: str):
    return build_orgchart(cid)


@app.get("/api/questionnaires/{qid}/coverage")
def api_coverage(qid: str):
    return build_coverage(qid)


@app.get("/api/clients/{cid}/requests")
def api_requests(cid: str):
    return JSONResponse({"requests": reqs.list_requests(cid), "text": reqs.render_request_list(cid)})
