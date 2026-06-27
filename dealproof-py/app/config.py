"""Runtime config — all via environment variables, sensible local defaults."""
import os

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
