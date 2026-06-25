# tools

Local helpers that run outside the Node app.

## extract_pdf_chart.py — vector PDF structure chart → snapshot (local)

Reads a **vector** PDF group-structure chart (the kind exported from
PowerPoint / Visio / Lucid, where text and lines are real objects, not a
scanned image) and produces a `StructureSnapshot` JSON plus a verification
overlay — **entirely on-machine**. Nothing is sent to any API, which is the
point for confidential charts: a vector PDF can be read locally, unlike a flat
image (which the app's vision import cannot name-mask).

```bash
pip install pymupdf
npm run chart:pdf -- path/to/chart.pdf -o /tmp/out
#   or: python3 tools/extract_pdf_chart.py path/to/chart.pdf -o /tmp/out
```

Outputs:
- `out.json` — the snapshot (entities + ownership/control edges; the
  parenthesised Vorzugskapital figure is preserved in each edge's `mechanism`).
- `out.entities.csv` — the entity inventory (name, kind, colour-class).
- `out.overlay.png` — boxes (blue) and inferred `parent → label → child` links
  (green), drawn on the chart so you can **see** what was captured.

### Important: edges are a draft

Box and percentage extraction are reliable. **Edge inference is best-effort** —
dense fan-in charts (e.g. long investor lists feeding one vehicle) will have
missing or mis-linked edges. That is by design handled downstream: load `out.json`
in the app's **Structure → Import** panel, which runs it through the same
reconcile/diff screen as every other source so a human verifies and corrects the
links before applying. Treat the overlay as the check, not the proof.

Keep extracted client data **out of the repo** — it is confidential. Write
outputs to a path outside the working tree (e.g. `/tmp`).
