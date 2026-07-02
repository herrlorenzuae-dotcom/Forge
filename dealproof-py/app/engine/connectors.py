"""Connectors — resolve the retrievable KYC questions from external providers.

Two providers:
  • Quantium   — Quantium Technology (quantium.pe), the firm's private-markets /
                 PE platform: portfolio-company, fund-structure, ownership and
                 entity master data (registration no., registered office,
                 incorporation date, legal form, directors, ...).
  • YSolutions — YSolutions by YPOG (ysolutions.legal): beneficial ownership /
                 German Transparenzregister (who the UBOs are, registration
                 status). PEP/sanctions screening is NOT covered by either
                 provider, so those questions stay manual.

Each provider runs a LIVE HTTP query when its base URL + API key are configured
(config.QUANTIUM_ENABLED / YSOLUTIONS_ENABLED); otherwise it returns clearly
labelled MOCK data (config.MOCK_CONNECTORS) so the demo and offline use keep
working. When you have the vendor's API spec, the only things to adjust are the
request path/params and the response-field mapping in the two `_*_live` helpers
— the routing, fallback and result shape stay the same.

On-file values are read from the project's real structure facts first; the rest
come from the connectors (live or mock).
"""
import json
import urllib.parse
import urllib.request
import urllib.error

from .. import config
from ..db import db, rows
from .coverage import classify_field
from .structure import get_structure

# field_type -> which provider answers it
SOURCE = {
    "registration_number": "quantium", "registered_office": "quantium",
    "incorporation_date": "quantium", "legal_form": "quantium", "directors": "quantium",
    "lei": "web", "listing": "web", "industry": "web",
    "beneficial_owner": "ysolutions",
}

# Mock sample answers (clearly fictional) keyed by field_type
MOCK = {
    "registration_number": "RCS Luxembourg B 271 904",
    "registered_office": "2, boulevard de la Foire, L-1528 Luxembourg",
    "incorporation_date": "9 February 2024",
    "legal_form": "Société à responsabilité limitée (S.à r.l.)",
    "directors": "Sophie Marchetti; Jean-Marc Weber",
    "lei": "391200CEDARBIDCO0007 (GLEIF — status: issued)",
    "listing": "Not listed on any stock exchange.",
    "industry": "Real-estate holding / logistics.",
    "beneficial_owner": "Dr. Anna Vogt and Maximilian Stein (each indirectly >25%); recorded in the German Transparenzregister.",
}
LABEL = {"quantium": "Quantium", "ysolutions": "YSolutions", "web": "Web research", "on_file": "On file"}


# ── On-file (the project's own structure facts / entity profile) ──
# field_type -> substring that identifies the attribute key holding the value
NEEDLES = {
    "legal_name": "full legal name",
    "registration_number": "registration", "registered_office": "registered address",
    "incorporation_date": "incorporation", "lei": "lei", "tax_residence": "tax residence",
    "source_of_funds": "source of funds", "pep": "pep", "legal_form": "legal form",
    "directors": "directors", "listing": "listing", "beneficial_owner": "beneficial owner",
    "signatory": "signator", "purpose_of_relationship": "purpose",
}


def _on_file_value(project_id: str, field_type: str):
    needle = NEEDLES.get(field_type)
    if not needle:
        return None
    with db() as con:
        for a in rows(con, "SELECT a.key, a.value, a.source FROM entity_attributes a JOIN entities e ON e.id=a.entity_id WHERE e.client_id=?", (project_id,)):
            if needle in a["key"].lower():
                return a
    return None


def _subject(project_id: str) -> dict:
    """The entity a KYC request concerns (the target/contracting entity), with
    the identifiers used to query the providers."""
    s = get_structure(project_id)
    ent = next((e for e in s["entities"] if e["role"] == "target"), None)
    if not ent and s["entities"]:
        ent = s["entities"][0]
    if not ent:
        return {}
    return {"name": ent.get("name", ""), "jurisdiction": ent.get("jurisdiction", ""),
            "registration_no": ent.get("registration_no", "")}


def _get(base: str, path: str, params: dict, api_key: str):
    """Minimal authenticated JSON GET (stdlib, so no extra dependency). Swap for
    httpx/requests if the vendor needs POST bodies or richer auth."""
    url = f"{base}{path}?{urllib.parse.urlencode({k: v for k, v in params.items() if v})}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {api_key}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=config.CONNECTOR_TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


# ── Quantium (registry / entity data) ──
# our field_type -> key in the provider's response (adapt to the real schema)
QUANTIUM_FIELD = {
    "registration_number": "registrationNumber", "registered_office": "registeredAddress",
    "incorporation_date": "incorporationDate", "legal_form": "legalForm", "directors": "directors",
}


def _quantium_live(subj: dict, field_type: str):
    data = _get(config.QUANTIUM_BASE_URL, "/v1/entities/search",
                {"name": subj.get("name"), "jurisdiction": subj.get("jurisdiction"),
                 "registrationNumber": subj.get("registration_no")}, config.QUANTIUM_API_KEY)
    if not isinstance(data, dict):
        return None
    val = data.get(QUANTIUM_FIELD.get(field_type, ""))
    if isinstance(val, list):
        val = "; ".join(str(x) for x in val)
    return str(val) if val else None


# ── YSolutions (beneficial ownership / Transparenzregister) ──
def _ysolutions_live(subj: dict, field_type: str):
    data = _get(config.YSOLUTIONS_BASE_URL, "/v1/beneficial-owners",
                {"name": subj.get("name"), "jurisdiction": subj.get("jurisdiction"),
                 "registrationNumber": subj.get("registration_no")}, config.YSOLUTIONS_API_KEY)
    if not isinstance(data, dict):
        return None
    if field_type == "beneficial_owner":
        owners = data.get("beneficialOwners") or []
        if not owners:
            return None
        parts = []
        for o in owners:
            pct = f" ({o['share']}%)" if o.get("share") else ""
            parts.append(f"{o.get('name', '?')}{pct}")
        reg = data.get("transparencyRegister", "")
        return "; ".join(parts) + (f" — {reg}" if reg else "")
    return None


_LIVE = {"quantium": _quantium_live, "ysolutions": _ysolutions_live}


def _provider_answer(project_id: str, field_type: str, provider: str):
    enabled = config.QUANTIUM_ENABLED if provider == "quantium" else config.YSOLUTIONS_ENABLED
    subj = _subject(project_id)
    if enabled and subj.get("name"):
        try:
            val = _LIVE[provider](subj, field_type)
            if val:
                return {"value": val, "source": provider, "source_label": LABEL[provider],
                        "detail": f"{LABEL[provider]} — live query for {subj['name']}."}
        except Exception as e:  # network/schema error → fall back, never crash answering
            if not config.MOCK_CONNECTORS:
                return {"value": "", "source": provider, "source_label": LABEL[provider],
                        "detail": f"{LABEL[provider]} query failed ({type(e).__name__}); add manually."}
    if config.MOCK_CONNECTORS and field_type in MOCK:
        return {"value": MOCK[field_type], "source": provider, "source_label": LABEL[provider],
                "detail": f"Mock {LABEL[provider]} data — connector not configured."}
    return None


def answer(project_id: str, prompt: str):
    """Return {value, source, source_label, detail} for a retrievable question,
    or None if it isn't connector/on-file answerable."""
    ft = classify_field(prompt)["fieldType"]

    onf = _on_file_value(project_id, ft)
    if onf:
        return {"value": onf["value"], "source": "on_file", "source_label": "On file",
                "detail": f"Held in the project's structure facts (source: {onf['source'] or 'on file'})."}

    if ft == "legal_name":
        from .projects import get_project
        name = ((get_project(project_id) or {}).get("subject_company") or "").strip() or _subject(project_id).get("name", "")
        if name:
            return {"value": name, "source": "on_file", "source_label": "On file",
                    "detail": "The project's subject company."}

    src = SOURCE.get(ft)
    if src in ("quantium", "ysolutions"):
        return _provider_answer(project_id, ft, src)
    if src == "web" and config.MOCK_CONNECTORS and ft in MOCK:
        # public-source research (e.g. a GLEIF LEI lookup) can slot in here later
        return {"value": MOCK[ft], "source": "web", "source_label": LABEL["web"],
                "detail": "Mock web research — live public-source lookup not wired yet."}
    return None


def status() -> dict:
    """Connection status for the health endpoint / UI."""
    return {
        "quantium": {"enabled": config.QUANTIUM_ENABLED,
                     "base_url": config.QUANTIUM_BASE_URL or None},
        "ysolutions": {"enabled": config.YSOLUTIONS_ENABLED,
                       "base_url": config.YSOLUTIONS_BASE_URL or None},
        "mock_fallback": config.MOCK_CONNECTORS,
    }
