"""Runtime config — all via environment variables, sensible local defaults."""
import os

DB_PATH = os.environ.get("DEALPROOF_DB", os.path.join(os.path.dirname(__file__), "..", "dealproof.db"))
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = os.environ.get("DEALPROOF_MODEL", "claude-opus-4-8")
STALE_DAYS = int(os.environ.get("DEALPROOF_STALE_DAYS", "180"))
# Privacy: jurisdictions are NOT sent to the model by default.
SEND_JURISDICTION = os.environ.get("DEALPROOF_SEND_JURISDICTION", "0") == "1"

HAS_KEY = bool(ANTHROPIC_API_KEY)
