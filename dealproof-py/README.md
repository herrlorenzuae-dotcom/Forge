# DealProof (FastAPI)

Python rebuild of DealProof — map a client's corporate structure (UBOs, entities)
onto any KYC questionnaire and answer it with cited facts; gaps are routed to a
public source or a client request. Runs with or without a model key (the KYC
Brain answers from the corpus).

## Run
```
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Open http://localhost:8000  (seeds the demo project "Demo — Project Cedar" on
first run). The landing page shows a **Connections** panel for the status below.

## Configuration
Set keys permanently in a `.env` file in this folder (loaded automatically on
startup, gitignored, never committed):
```
cp .env.example .env        # then edit .env and add your key(s)
```
Or export them in your shell — real environment variables override the file.
All are optional; DealProof runs fully offline with the KYC Brain + mock connectors.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the model to draft cited answers / extract questions for items the Brain and connectors don't cover. |
| `DEALPROOF_MODEL` | Model id (default `claude-opus-4-8`). |
| `QUANTIUM_BASE_URL`, `QUANTIUM_API_KEY` | Quantium Technology (quantium.pe) — portfolio-company / fund / entity data. Live when both are set. |
| `YSOLUTIONS_BASE_URL`, `YSOLUTIONS_API_KEY` | YSolutions by YPOG (ysolutions.legal) — beneficial ownership / German Transparenzregister. Live when both are set. |
| `DEALPROOF_MOCK_CONNECTORS` | `1` (default) falls back to labelled mock data when a connector isn't configured; `0` shows it as unavailable. |
| `DEALPROOF_CONNECTOR_TIMEOUT` | Connector HTTP timeout in seconds (default `8`). |
| `DEALPROOF_PASSWORD` | Optional: require a login (for shared/server use). Unset = open (local single-user). |

Backups: the landing page has a **Download backup** link (the full SQLite database
— projects, answers, structure, Brain). To restore, replace `dealproof.db` with
the downloaded file while the app is stopped.

Example:
```
export ANTHROPIC_API_KEY=sk-ant-...
export QUANTIUM_BASE_URL=https://api.quantium.pe   QUANTIUM_API_KEY=...
export YSOLUTIONS_BASE_URL=https://api.ysolutions...  YSOLUTIONS_API_KEY=...
uvicorn app.main:app --reload --port 8000
```
`GET /api/health` reports the live status of all three. A connector goes live
automatically once its base URL **and** key are present; the request path and
response-field mapping live in `app/engine/connectors.py` (`_quantium_live` /
`_ysolutions_live`) — the only place to adjust per the vendor's API spec.
