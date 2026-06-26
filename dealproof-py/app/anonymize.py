"""On-device name masking. Entity and beneficial-owner names are replaced with
placeholders before anything is sent to a model, and restored locally on the
way back. Longest names first so substrings don't get partially masked."""
import re
from .db import db, rows


def build_registry(client_id: str) -> dict:
    """Map real name -> placeholder token for one client."""
    with db() as con:
        ents = rows(con, "SELECT name FROM entities WHERE client_id=?", (client_id,))
        ubos = rows(con,
                    "SELECT e.name FROM ubos u JOIN entities e ON e.id=u.entity_id WHERE u.client_id=?",
                    (client_id,))
    names = sorted({r["name"] for r in ents + ubos if r["name"]}, key=len, reverse=True)
    reg = {}
    for i, n in enumerate(names, 1):
        reg[n] = f"[ENTITY_{i}]"
    return reg


def mask(text: str, reg: dict) -> str:
    for name, token in reg.items():
        text = re.sub(re.escape(name), token, text)
    return text


def restore(text: str, reg: dict) -> str:
    for name, token in reg.items():
        text = text.replace(token, name)
    return text
