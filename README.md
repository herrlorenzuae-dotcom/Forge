# Forge: a fund formation prototype

**Forge is a working prototype of a local-first tool for private-fund
formation — drafting, negotiation, side letters, and the decade of
obligations that follows the close. Every answer quotes your own documents
verbatim, and every client name is masked on your machine before anything
goes out, so a lawyer can actually check it.**

<p align="center">
  <img src="docs/demo.gif" alt="A real run on the seeded demo fund: a plain-English question to the obligations register returns an urgency-ordered answer where every duty cites the clause that created it (10/10 verified), and the privacy panel shows exactly what left the machine." width="820">
</p>

<p align="center"><sub>One real run on the seeded demo fund — a plain-English question, an answer where every line quotes the clause that created the duty (10/10 verified), and the on-device panel showing exactly what left the machine. Nothing staged; this is the app.</sub></p>

It's inspired by the Kirkland & Ellis / Palantir "Fund Formation Engine"
demo. I'm not claiming feature parity — I have no idea what they're actually
building — and this isn't a replacement for anything. I took the
announcement as a challenge and built something similar from publicly
available sources.

> "The idea is that we're going to take the collective intelligence of our
> institution and be able to deploy that throughout our firm."

Anyone can build almost anything right now, so the question that interests
me isn't "can you build it" — it's "is it any good, and where does the
value actually come from?" Two answers it is *not*:

- **Not the model.** Forge was built on Fable, Anthropic's most powerful
  model at the time. Days later Fable became unavailable, and moving to
  Opus 4.8 took an afternoon — Forge barely noticed. The model was never
  the moat; it's a swappable dependency that can vanish overnight.
- **Not proprietary data.** Fund formation may be the most documented
  corner of law there is — model terms, market surveys, form precedents,
  LPs who see hundreds of deals a year.

So what's left? The two things this prototype is actually built around —
both of which the public demo never showed:

1. **Machine-verified citations.** Every assertion the AI makes must quote
   its source, and the quote is checked word-for-word against the document
   on file. A green check means the words are really there. A red cross
   means they are not, and Forge never hides which. (The FT article this
   project started from is bookended by two firms sanctioned for AI
   hallucinations.)
2. **Confidentiality you can inspect.** Names are masked on the lawyer's
   own machine before any frontier call. A panel shows the exact payload
   that left. Matters live in separate encrypted files.

That's the conversation I want to have. Forge is released as-is: maybe
there's an idea in it you can use, maybe a funds lawyer tears it apart and
we end up with something useful. Either way, let's work out what's actually
worth building.

### Why local-first

Fund formation runs on the most sensitive data a firm holds: LP identities,
commitment sizes, bespoke side-letter economics, all under ethical-wall and
client-confidence duties. "Send it to a cloud AI" is usually where the
compliance conversation ends. So the sensitive layer stays on the machine:
the raw names, the documents, retrieval, the database. Only name-masked,
sanitized text crosses the boundary to the frontier model. Local-first
rather than local-only: you get frontier-grade reasoning without handing
over the confidential data to get it.

Fictional client: **Vulcan Industrial Partners** (named for the Roman god
of the forge), raising Fund III at $3B with 14 investors. Not legal advice,
not a law firm, not affiliated with anyone.

## What it does

**Bring your own documents.** The Documents tab is the point of the tool.
Create an engagement, upload your own LPA or side letter (PDF, Word,
Markdown, or text), and the engine parses it on-device, pulls out every
ongoing obligation, and checks each one word-for-word against the source
before it enters your register. Then you ask the register questions in
plain English. Side letters are linked to their investor, auto-detected
from the letter or named at upload, and unknown LPs are created on the
spot, so the MFN compendium, deadlines, and attribution all run on your
documents rather than the demo's. Investors and their comments come in the
same way: add an LP, paste their counsel's actual mark-up, and the
negotiation stage works on what they really sent. The Vulcan corpus is a
worked example. Every pipeline treats your uploads exactly the same.

The full demo arc, each stage thin but real:

1. **Drafting.** Paste a commercial term sheet. Four specialized roles
   (insight capturer, extractor, drafter, feedback integrator) draft LPA
   sections from the model library, prior funds, and what investors pushed
   back on last time. Progress streams live.
2. **Change assessment.** "Expand the geographic mandate to emerging
   markets" returns the provision's current reading, market examples from
   your corpus, and a menu of drafting alternatives, most conservative
   first.
3. **Comment triage.** Paste LP counsel's mark-up or email and it is
   atomized into individual deal-point comments. The queue is organized by
   deal point, with suggested resolutions citing model language and the
   investor's own precedent. Accepting or editing is a plain database
   write. The lawyer's judgment never leaves the loop.
4. **Side letters.** Agreed terms in, three complete drafts out, following
   the reuse hierarchy: exact model language, adapted precedent, fresh
   drafting. Every clause is color-coded by where its words came from.
   Before you mark a draft executed, the MFN exposure forecast runs: a
   deterministic sweep of the register (no model call) that classifies each
   clause into the three classes practitioners use — universally electable,
   status-matched (electable only by an investor of the same legal/tax
   status), or excluded — names exactly who could elect it at the post-close
   election, and projects the annual cost of the economic terms. (MFN is
   settled after the final close in a batched written election, typically a
   30-day window; the forecast is what you would owe then, not a charge at
   signing.) Then mark the signed draft as executed and the loop closes: it
   is filed against its investor, its clauses become house precedent, its
   duties land on the register, and the next MFN run sees it.
5. **Obligations register.** "We have a time-sensitive new deal in
   sub-Saharan Africa. What obligations do we have?" returns an answer, an
   urgency-ordered checklist, and the affected investors, with every step
   citing the clause that created the duty, verified verbatim.
6. **MFN compendium (the side letter summary).** Every side-letter
   provision in the fund, the eligibility threshold and election window
   parsed from the fund's own MFN clause, who can elect what (grantee
   excluded), the election deadline, and the three-class classification
   (universal / status-matched / excluded) with the reasoning cited. ("Side
   letter summary" and "compendium" are both real practitioner terms for
   this artifact; a "master side letter" is a different thing — assembled
   from a prior fund's letters to set house positions for the next raise.)
7. **Word-native deliverables.** The compendium and side-letter drafts
   export as clean .docx with a numbered Sources annex. Every in-text [n]
   marker resolves to the verbatim quoted clause, its ontology id, and its
   verification mark, so verification survives the export.
8. **Matter workspaces.** Each matter is a separate database file and only
   the open one is readable, so cross-matter contamination is impossible by
   construction. Closed matters can be locked: encrypted at rest with
   AES-256-GCM under a passphrase-derived key (scrypt).
9. **Scanned PDFs work.** When a PDF has no text layer, pages are rendered
   and OCR'd entirely on-device. The only network access is a one-time
   download of Tesseract's public English model (about 15 MB). Document
   content never leaves the machine.
10. **The compounding loop.** Resolutions a lawyer accepted or edited,
    clauses from executed side letters, and sections revised under feedback
    are promoted to weighted house precedent and feed the next suggestion,
    citably. Every engagement makes the next one smarter, and the Overview
    shows what has been learned.
11. **Deadlines.** Concrete due dates for every recurring duty, with
    quarterly and annual anchors and business-day math read from the clause
    itself. An event planner ("closing July 15 means notice to Norrland by
    June 24"), drafted reminder emails with verified citations, and
    one-click iCalendar export. The date math is deterministic and local;
    only the email drafting touches the frontier.

## The two models

- **Frontier:** `claude-opus-4-8` (Anthropic) does the drafting and
  reasoning. Structured output only; every response is schema-validated.
- **Local** (Ollama, on your machine) plays two roles:
  - **Privacy gateway.** Before any text leaves the machine, fund and
    investor names (including derived short forms) are replaced with
    reversible placeholders, using the ontology as the source of truth. A
    local NER pass then catches names the ontology has never seen. The
    frontier model sees `[INVESTOR_3]`; your client list stays home. Next
    to a masked name only the investor's type is sent ("pension", "family
    office"). Jurisdiction is held back by default, because type and
    jurisdiction together can re-identify an LP in a small fund. Set
    `FORGE_SEND_JURISDICTION=1` to opt in.
  - **Local search.** Embeddings plus SQLite FTS5 hybrid retrieval.
    Retrieval always runs locally on raw data.

The **"What left your machine"** panel shows the exact sanitized payload of
every frontier call. When Ollama is down, everything degrades gracefully:
regex-only anonymization, keyword-only search, and a visible badge.

**The promise, stated precisely.** What gets masked is names: fund,
investor, and (via NER) other parties. The legal text itself, including
amounts and dates, is sent in clear, because that is what makes verbatim
citation checking possible. Third-party names inside uploaded documents are
protected by the local NER pass alone. When Ollama is down, names the
ontology doesn't know travel unmasked, and the badge says so.

**Citations are enforced.** Every assertion must quote its source, and
quotes are verified verbatim (whitespace-normalized) against the ontology
after de-anonymization. Unverified citations are flagged in the UI.

## Run it

Three steps from clone to a working firm:

```bash
npm install && npm run setup  # installs the UI, builds it, seeds the demo corpus
cp .env.example .env          # add your ANTHROPIC_API_KEY
npm run dev                   # http://localhost:3000
```

Then try the demo moment. Open **Obligations** and ask the prefilled
question: *"We have a time-sensitive new deal in sub-Saharan Africa. What
obligations do we have?"* Thirty seconds later you have an urgency-ordered
checklist where every step quotes the clause that created the duty, each
quote machine-verified against the document. Then go to **Documents**,
upload one of your own contracts, and watch the same thing happen to it.

Optional but recommended, the local model for the privacy gateway and
semantic search (everything degrades gracefully without it):

```bash
ollama pull gemma2:2b && ollama pull nomic-embed-text
```

Dev UI with hot reload: `cd web && npm run dev`, then http://localhost:5173.

## Verify

```bash
npm test          # unit tests, no network
npm run smoke     # end-to-end through all five stages plus a degraded pass
                  # (needs ANTHROPIC_API_KEY; SMOKE_SKIP_DRAFTING=1 skips the slow stage)
npm run eval      # the honesty check: extraction recall and precision against
                  # hand-labeled documents (including unseen ones), plus Q&A
                  # retrieval recall. Citation verification proves what the
                  # engine SAYS; the eval measures what it MISSES. Every metric
                  # on the scoreboard is gated (recall, precision, field
                  # accuracy, verified-verbatim share, Q&A recall) and the
                  # chance baseline is printed next to the result.
```

## Layout

```
src/
  config.ts             env-backed configuration
  db/                   SQLite ontology: funds, investors, documents,
                        provisions, comments, side_letters, obligations,
                        precedents, ai_calls audit, embeddings; FTS5 + triggers
  workspaces/           matter workspaces: one encrypted SQLite file per
                        matter (the ethical wall); lock/unlock with AES-256-GCM
  privacy/anonymize.ts  reversible placeholder anonymizer (regex, local)
  ai/ollama.ts          local model client (NER chat + embeddings + health)
  ai/gateway.ts         the privacy gateway; nothing leaves unsanitized
  ai/claude.ts          the ONE place the frontier model is called: sanitize,
                        call, de-anonymize, verify citations, audit
  search/               hybrid retrieval (BM25 + cosine, degrades to BM25)
  documents/parser.ts   parse uploaded PDF/DOCX/MD/TXT into citable provisions
  documents/ocr.ts      on-device OCR fallback for scanned PDFs (pdf.js + Tesseract)
  engine/
    intake.ts           create a matter + ingest your own documents
    obligations.ts      extraction + plain-English Q&A over the register
    drafting.ts         the four-role drafting pipeline (SSE progress)
    changes.ts          mid-raise term-change assessment
    comments.ts         investor-comment triage + suggested responses
    side-letters.ts     three-way side-letter drafting + execution
    mfn.ts              MFN compendium (eligibility, electability, deadline)
    deadlines.ts        deterministic due dates, event planner, reminder emails, ICS
    precedent.ts        the compounding loop: weighted house precedent
    citations.ts        verbatim citation verifier (the trust core)
    progress.ts         in-memory run registry for SSE
  export/docx.ts        Word-native deliverables with a verified Sources annex
  api/routes.ts         REST + SSE
  seed/seed.ts          loads seed/ (the fictional Vulcan corpus)
  eval/score.ts         recall/precision scorer for the eval harness
web/                    React 19 + Vite + Tailwind 4 dashboard
scripts/smoke.ts        end-to-end smoke test
scripts/eval.ts         recall eval runner (see Verify above)
eval/                   hand-labeled documents + Q&A ground truth
```
