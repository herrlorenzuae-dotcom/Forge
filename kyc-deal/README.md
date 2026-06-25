# KYC Deal

**A local-first tool that maps a client's corporate structure — the UBOs and
the entities above the asset — onto the KYC questionnaires that banks and
service providers keep sending, and answers them with citations you can
check. Every answer quotes the structure fact it rests on; every name is
masked on your machine before anything goes to a model.**

The premise: when a client acquires an asset, an entity in the acquisition
structure receives KYC questionnaires from banks and service providers. The
forms differ wildly in layout — but the *answer* barely moves between deals,
because the structure behind it barely moves. The UBO is who they were. So
the work isn't research, it's **mapping**: line up the questions with the
structure you already hold, and answer them consistently. KYC Deal does that,
and remembers every answer so the next questionnaire is mostly already done.

> Built as a sibling to **Forge** (the fund-formation engine) — same
> local-first spine, same verified-citation discipline, same design
> language — pointed at KYC instead of fund formation.

## What it does

1. **Holds the structure** — entities, ownership edges, ultimate beneficial
   owners and registry facts — pulled from the client's systems of record via
   connectors. It is the source of truth every answer maps back to.
2. **Draws the org chart** deterministically from that structure (no model
   call — a pure projection, so it always matches the data).
3. **Ingests any questionnaire.** Paste a bank's form; it is split into atomic
   questions (by the model, or by a deterministic parser offline).
4. **Maps and answers.** Each question is answered from the structure, citing
   the exact fact relied upon. Citations are verified verbatim against the
   store before the answer is shown — a green check means the words are really
   there.
5. **Grows a KYC Brain.** Every finalized questionnaire folds its answers into
   a library keyed by the question. Recurring questions converge on one
   settled answer; *optionality* (the count of distinct answers) falls as the
   corpus grows, so the next form mostly answers itself — even with no model
   key set.

## The two data systems (via MCP)

The client's data already lives in two tools, reached through the connector
seam in `src/connectors/` — never a vendor SDK directly, so swapping the
bundled mock for the real systems is a single implementation.

- **Quantium** — the corporate skeleton (entities, ownership, UBOs, registry
  facts) **and** the currency / *Aktualität* check: how old is each record,
  and is anything past the staleness threshold?
- **YSolutions** — the softer KYC layer: contacts, source of funds and wealth,
  FATCA/CRS and tax classifications.

Both are exposed as **MCP servers** (Model Context Protocol, over stdio) so any
MCP client can call them:

```bash
npm run mcp:quantium      # tools: get_structure, verify_currency
npm run mcp:ysolutions    # tools: get_data
```

The app itself talks to the same operations through the in-process `mock`
connector by default (`KYC_CONNECTOR=mock`), so it runs from a clean clone
with no external systems. Point it at the real Quantium / YSolutions by
implementing the `StructureConnector` / `DataConnector` interfaces (see
`src/connectors/types.ts`) or by wiring an MCP client to the servers above.

## Structure import & staying dynamic

The structure is never write-once. The org chart is a *pure projection* of the
stored entities and links, so any change to the data re-renders it — there is
no frozen "version" to regenerate by hand.

- **Import a delivered group chart**, two ways into the same
  `StructureSnapshot`:
  - **Excel** (`npm run template:xlsx` writes the template — two sheets,
    *Entities* and *Relationships*). Deterministic and **fully local**: no data
    leaves the machine.
  - **Chart image (PNG/JPG)** read by the vision model — export a
    PowerPoint / Visio / Lucid chart to an image and drop it in. The model
    extracts entities and ownership/control links. **Privacy tradeoff:** a chart
    image *cannot* be name-masked, so this path sends the image (with its
    names) to the model. The UI says so, and Excel remains the no-send
    alternative. Requires `ANTHROPIC_API_KEY`.
- **Reconciled, never overwritten.** Every import is diffed against what's on
  file by natural key (registration number, else name + jurisdiction) and
  surfaced as **added / changed (with the exact field conflict) / missing**. A
  human applies the changes; optionally prune entities and links the new chart
  drops. Nothing is silently replaced — the audit trail a bank relies on
  stays intact.
- **Ownership vs. control, modelled separately.** Ownership edges carry a %;
  control edges carry a *mechanism* (voting majority, board control,
  shareholders' agreement, GP/manager, veto rights) and render dashed. The
  chart's purpose is to let the bank follow the **control structure**, not
  just the cash-flow ownership.
- **Manual edits are first-class.** Add, correct or delete an entity or link
  via the API; the chart updates immediately.

## Confidentiality

KYC data is the most sensitive a client holds. Entity and beneficial-owner
names are replaced with reversible placeholders **on your machine**, built
from the client's own structure, before any frontier call — and restored
locally on the way back. The **Privacy** panel shows the exact payload that
left, names already masked. The model sees `[ENTITY_1]` and `[PERSON_2]`; your
client list stays home.

## Run it

```bash
npm install && npm run setup   # installs the UI, builds it, seeds the demo
cp .env.example .env           # optional: add ANTHROPIC_API_KEY to draft answers
npm run dev                    # http://localhost:3000
```

The demo seeds **Project Halcyon**: a Luxembourg BidCo acquiring the Meridian
Logistics Park, owned up through a German topco to two individuals — plus two
historical questionnaires (Nordbank AG, Crédit Lac SA) already folded into the
Brain, and a fresh one from Banque de Genève waiting to be answered.

**Without an API key** the tool still works: the org chart, the structure, the
connectors and the KYC Brain all run locally, and a new questionnaire is
answered from the dominant prior answers in the Brain. **With a key**, the
model parses unfamiliar forms and drafts answers for questions the Brain has
never seen, citing the structure.

Dev UI with hot reload: `cd web && npm run dev`, then http://localhost:5173.

## Verify

```bash
npm test          # unit tests, no network (brain convergence, org chart,
                  # name masking round-trip, citation verification)
npm run typecheck # tsc, no emit
```

## Layout

```
src/
  config.ts              env-backed configuration
  types.ts               shared domain shapes
  db/                    SQLite ontology: clients, entities, ownership_edges,
                         ubos, entity_attributes, questionnaires, questions,
                         answers, answer_library (the Brain), source_syncs, ai_calls
  privacy/anonymize.ts   reversible on-device name masking
  ai/claude.ts           the ONE frontier call site: mask → call → restore → audit
  ai/schemas.ts          zod schemas for every structured call
  connectors/            the seam to the client's systems
    types.ts             StructureConnector / DataConnector interfaces
    quantium.ts          structure + currency (mock)
    ysolutions.ts        supplemental KYC data (mock)
    excel.ts             parse a structure workbook into a snapshot + template
    mock-data.ts         the Project Halcyon fixture
  mcp/                   MCP server entrypoints (quantium, ysolutions)
  scripts/make-template.ts   emit the blank Excel import template
  engine/
    structure.ts         pull from connectors, mirror locally, verify currency
    reconcile.ts         diff a delivered snapshot vs the store; apply by key
    edit.ts              manual entity/link upsert + delete
    orgchart.ts          deterministic Mermaid org chart (ownership + control)
    intake.ts            parse a questionnaire into atomic questions
    mapping.ts           map a question to facts and answer, with brain priors
    brain.ts             the answer library: convergence + optionality
    citations.ts         verbatim citation verifier (the trust core)
    questionnaire.ts     read helpers + finalize-into-Brain
  api/routes.ts          REST
  server.ts              Fastify; serves web/dist when built
  seed/seed.ts           the Project Halcyon demo
web/                     React 19 + Vite + Tailwind 4 dashboard (mermaid org chart)
```

## Notes & roadmap

- Brain matching is currently exact on a normalized question key (banks reuse
  each other's wording, so this hits often). Fuzzy/semantic matching of
  similar-but-not-identical questions is the obvious next step.
- Structure import covers the deterministic Excel snapshot and vision
  extraction from a chart image. Native PowerPoint (.pptx) / Visio (.vsdx)
  parsing (rather than export-to-image) is a possible next step — it would emit
  the same `StructureSnapshot`. The vision prompt is best tuned against a
  representative real chart.
- Questionnaire intake is text/paste today; PDF and Word ingestion would slot
  in at `engine/intake.ts`.
- Word/PDF export of a completed questionnaire (with a verified sources annex,
  as Forge does) is a natural addition.

Fictional client; not legal advice; not affiliated with anyone.
