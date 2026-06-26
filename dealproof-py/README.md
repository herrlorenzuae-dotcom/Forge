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
Open http://localhost:8000  (seeds the demo client "Project Halcyon" on first run).

Optional: set `ANTHROPIC_API_KEY` to have the model draft cited answers for
questions the Brain hasn't seen.
