"""Runtime config — all via environment variables, sensible local defaults.

Keys can be set permanently in a `.env` file in the project root (gitignored,
never committed). It is loaded here at import time; real shell environment
variables always win over the file."""
import os


def _load_dotenv():
    """Minimal .env loader (no dependency). KEY=value per line; # comments and
    surrounding quotes are ignored. Does not override already-set env vars."""
    path = os.path.join(os.path.dirname(__file__), "..", ".env")
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key, val = key.strip(), val.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = val
    except FileNotFoundError:
        pass


_load_dotenv()

DB_PATH = os.environ.get("DEALPROOF_DB", os.path.join(os.path.dirname(__file__), "..", "dealproof.db"))
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = os.environ.get("DEALPROOF_MODEL", "claude-opus-4-8")
STALE_DAYS = int(os.environ.get("DEALPROOF_STALE_DAYS", "180"))
# Privacy: jurisdictions are NOT sent to the model by default.
SEND_JURISDICTION = os.environ.get("DEALPROOF_SEND_JURISDICTION", "0") == "1"

HAS_KEY = bool(ANTHROPIC_API_KEY)

# ── External KYC connectors ────────────────────────────────────────────────
# Quantium (Quantium Technology, quantium.pe — the firm's private-markets / PE
# platform holding portfolio-company, fund and entity data) and YSolutions
# (screening / PEP / sanctions). Each is "live" only when both a base URL and an
# API key are configured; otherwise the connector returns clearly labelled mock
# data so the demo and offline use keep working.
QUANTIUM_BASE_URL = os.environ.get("QUANTIUM_BASE_URL", "").rstrip("/")
QUANTIUM_API_KEY = os.environ.get("QUANTIUM_API_KEY", "")
QUANTIUM_ENABLED = bool(QUANTIUM_BASE_URL and QUANTIUM_API_KEY)

YSOLUTIONS_BASE_URL = os.environ.get("YSOLUTIONS_BASE_URL", "").rstrip("/")
YSOLUTIONS_API_KEY = os.environ.get("YSOLUTIONS_API_KEY", "")
YSOLUTIONS_ENABLED = bool(YSOLUTIONS_BASE_URL and YSOLUTIONS_API_KEY)

# Fall back to mock data for any connector that isn't configured (default on so
# the demo works; set to 0 to surface unconfigured connectors as "unavailable").
MOCK_CONNECTORS = os.environ.get("DEALPROOF_MOCK_CONNECTORS", "1") == "1"
CONNECTOR_TIMEOUT = float(os.environ.get("DEALPROOF_CONNECTOR_TIMEOUT", "8"))

# ── Tenants (Mandanten) ────────────────────────────────────────────────────
# Every session belongs to ONE tenant; each tenant gets its own database file
# (projects, structures AND the KYC Brain are strictly per tenant). Configure
# via DEALPROOF_TENANTS="Name:password,Other:pw2". This is the mock login —
# the login layer is designed to be swapped for SSO / real accounts later.
# Legacy DEALPROOF_PASSWORD maps to a single "Workspace" tenant; with nothing
# configured a "Demo" tenant (password "demo") keeps local use working.
PASSWORD = os.environ.get("DEALPROOF_PASSWORD", "")


def _parse_tenants():
    raw = os.environ.get("DEALPROOF_TENANTS", "").strip()
    out = []
    for part in raw.split(","):
        if ":" in part:
            name, pw = part.split(":", 1)
            if name.strip() and pw.strip():
                out.append({"name": name.strip(), "password": pw.strip()})
    if not out and PASSWORD:
        out = [{"name": "Workspace", "password": PASSWORD}]
    if not out:
        out = [{"name": "Demo", "password": "demo"}]
    import re as _re
    for t in out:
        t["slug"] = _re.sub(r"[^a-z0-9]+", "-", t["name"].lower()).strip("-") or "tenant"
    return out


TENANTS = _parse_tenants()
DATA_DIR = os.environ.get("DEALPROOF_DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))


def tenant_db_path(slug: str) -> str:
    return os.path.join(DATA_DIR, f"{slug}.db")
