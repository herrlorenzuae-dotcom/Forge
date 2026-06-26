"""Optional frontier model. Names are masked before sending and restored after.
Only used when ANTHROPIC_API_KEY is set; otherwise mapping falls back to the
KYC Brain. JSON-mode answering with citations."""
import json
from . import config
from .db import db, gen_id
from .anonymize import build_registry, mask, restore

SYSTEM = (
    "You answer a KYC questionnaire question using ONLY the provided structure facts. "
    "Bracketed tokens like [ENTITY_1] are protected references — reproduce them exactly. "
    "Reply as strict JSON: {\"value\": str, \"rationale\": str, "
    "\"citations\": [{\"factType\": \"entity|edge|ubo|attribute\", \"factId\": str, \"quote\": str}]}. "
    "Cite the exact fact id(s) your answer rests on, quoting the fact verbatim. "
    "If no fact supports an answer, return an empty value and empty citations."
)


def available() -> bool:
    return config.HAS_KEY


def answer(client_id: str, prompt: str, context: str) -> dict:
    """Returns {value, rationale, citations} with names restored. Raises on error."""
    import anthropic
    reg = build_registry(client_id)
    user = f"STRUCTURE FACTS:\n{mask(context, reg)}\n\nQUESTION:\n{mask(prompt, reg)}"
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    resp = client.messages.create(
        model=config.MODEL, max_tokens=1500, system=SYSTEM,
        messages=[{"role": "user", "content": user}],
    )
    raw = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
    with db() as con:
        con.execute("INSERT INTO ai_calls (id, stage, model, sanitized_prompt, masked, ok) VALUES (?,?,?,?,?,1)",
                    (gen_id("call"), "mapping", config.MODEL, f"SYSTEM:\n{SYSTEM}\n\nUSER:\n{user}", len(reg)))
    m = raw.find("{"); n = raw.rfind("}")
    data = json.loads(raw[m:n + 1]) if m >= 0 else {"value": "", "rationale": "", "citations": []}
    return {
        "value": restore(data.get("value", ""), reg),
        "rationale": restore(data.get("rationale", ""), reg),
        "citations": [{**c, "quote": restore(c.get("quote", ""), reg)} for c in data.get("citations", [])],
    }
