/** REST API. Thin handlers over the engine; every write is a plain function
 *  call so the logic stays testable without HTTP. */

import type { FastifyInstance } from 'fastify';
import { getDb, genId, today } from '../db/db.js';
import { config } from '../config.js';
import { hasKey } from '../ai/claude.js';
import { getStructure, refreshFromConnectors, verifyCurrency, listSyncs } from '../engine/structure.js';
import { buildOrgChart } from '../engine/orgchart.js';
import { diffStructure, applyStructure } from '../engine/reconcile.js';
import { parseStructureWorkbook } from '../connectors/excel.js';
import { upsertEntity, deleteEntity, upsertEdge, deleteEdge } from '../engine/edit.js';
import type { StructureSnapshot } from '../connectors/types.js';
import { createQuestionnaire } from '../engine/intake.js';
import { answerQuestion, answerQuestionnaire, setAnswer } from '../engine/mapping.js';
import { listQuestionnaires, getQuestionnaire, finalizeQuestionnaire } from '../engine/questionnaire.js';
import { listBrain, brainStats } from '../engine/brain.js';

interface ClientRow {
  id: string;
  name: string;
  deal_name: string;
  asset: string;
  created_at: string;
}

export function registerRoutes(app: FastifyInstance): void {
  const wrap = (fn: () => unknown | Promise<unknown>) => async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    try {
      const r = await fn();
      return r;
    } catch (err) {
      reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  app.get('/api/health', async () => ({
    ok: true,
    model: config.anthropic.model,
    anthropicKey: hasKey(),
    connector: config.connector,
    staleDays: config.staleDays,
  }));

  app.get('/api/clients', async () => getDb().prepare(`SELECT * FROM clients ORDER BY created_at`).all() as ClientRow[]);

  // ── Structure ──
  app.get<{ Params: { id: string } }>('/api/clients/:id/structure', async (req) => getStructure(req.params.id));
  app.get<{ Params: { id: string } }>('/api/clients/:id/orgchart', async (req) => buildOrgChart(req.params.id));
  app.get<{ Params: { id: string } }>('/api/clients/:id/syncs', async (req) => listSyncs(req.params.id));

  app.post<{ Params: { id: string } }>('/api/clients/:id/refresh', (req, reply) =>
    wrap(() => refreshFromConnectors(req.params.id, req.params.id))(req, reply),
  );
  app.post<{ Params: { id: string } }>('/api/clients/:id/verify-currency', (req, reply) =>
    wrap(() => verifyCurrency(req.params.id, req.params.id))(req, reply),
  );

  // ── Structure import & reconciliation ──

  // Preview-only: diff a delivered snapshot against the stored structure.
  app.post<{ Params: { id: string }; Body: { snapshot?: StructureSnapshot } }>('/api/clients/:id/structure/reconcile', (req, reply) =>
    wrap(() => {
      if (!req.body?.snapshot) throw new Error('snapshot is required');
      return diffStructure(req.params.id, req.body.snapshot);
    })(req, reply),
  );

  // Apply a snapshot (upsert by natural key; optional prune of missing rows).
  app.post<{ Params: { id: string }; Body: { snapshot?: StructureSnapshot; removeMissing?: boolean } }>('/api/clients/:id/structure/apply', (req, reply) =>
    wrap(() => {
      if (!req.body?.snapshot) throw new Error('snapshot is required');
      const result = applyStructure(req.params.id, req.body.snapshot, { removeMissing: req.body.removeMissing });
      getDb()
        .prepare(`INSERT INTO source_syncs (id, client_id, connector, op, ok, items, stale_items, as_of, message) VALUES (?, ?, 'import', 'apply_structure', 1, ?, 0, ?, ?)`)
        .run(
          genId('sync'),
          req.params.id,
          result.entitiesAdded + result.entitiesUpdated,
          today(),
          `Applied structure: +${result.entitiesAdded} entities, ~${result.entitiesUpdated} updated, +${result.edgesAdded} edges, ~${result.edgesUpdated} updated, −${result.entitiesRemoved} entities / −${result.edgesRemoved} edges removed.`,
        );
      return result;
    })(req, reply),
  );

  // Excel upload: parse a workbook into a snapshot and return it with the diff.
  app.post<{ Params: { id: string } }>('/api/clients/:id/import/excel', async (req, reply) => {
    try {
      const data = await (req as unknown as { file: () => Promise<{ toBuffer: () => Promise<Buffer> } | undefined> }).file();
      if (!data) throw new Error('no file uploaded');
      const buf = await data.toBuffer();
      const snapshot = parseStructureWorkbook(buf);
      const diff = diffStructure(req.params.id, snapshot);
      return { snapshot, diff };
    } catch (err) {
      reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Manual structure edits ──
  app.post<{ Params: { id: string }; Body: Parameters<typeof upsertEntity>[1] }>('/api/clients/:id/entities', (req, reply) =>
    wrap(() => upsertEntity(req.params.id, req.body))(req, reply),
  );
  app.delete<{ Params: { id: string; eid: string } }>('/api/clients/:id/entities/:eid', (req, reply) =>
    wrap(() => deleteEntity(req.params.id, req.params.eid))(req, reply),
  );
  app.post<{ Params: { id: string }; Body: Parameters<typeof upsertEdge>[1] }>('/api/clients/:id/edges', (req, reply) =>
    wrap(() => upsertEdge(req.params.id, req.body))(req, reply),
  );
  app.delete<{ Params: { id: string; eid: string } }>('/api/clients/:id/edges/:eid', (req, reply) =>
    wrap(() => deleteEdge(req.params.id, req.params.eid))(req, reply),
  );

  // ── Questionnaires ──
  app.get<{ Params: { id: string } }>('/api/clients/:id/questionnaires', async (req) => listQuestionnaires(req.params.id));

  app.post<{ Params: { id: string }; Body: { requester?: string; title?: string; rawText?: string } }>(
    '/api/clients/:id/questionnaires',
    (req, reply) =>
      wrap(() =>
        createQuestionnaire({
          clientId: req.params.id,
          requester: req.body?.requester ?? '',
          title: req.body?.title ?? 'Untitled questionnaire',
          rawText: req.body?.rawText ?? '',
        }),
      )(req, reply),
  );

  app.get<{ Params: { id: string } }>('/api/questionnaires/:id', (req, reply) =>
    wrap(() => {
      const d = getQuestionnaire(req.params.id);
      if (!d) throw new Error('Questionnaire not found');
      return d;
    })(req, reply),
  );

  app.post<{ Params: { id: string } }>('/api/questionnaires/:id/answer', (req, reply) =>
    wrap(() => answerQuestionnaire(req.params.id))(req, reply),
  );

  app.post<{ Params: { id: string } }>('/api/questionnaires/:id/finalize', (req, reply) =>
    wrap(() => finalizeQuestionnaire(req.params.id))(req, reply),
  );

  app.post<{ Params: { id: string } }>('/api/questions/:id/answer', (req, reply) =>
    wrap(() => answerQuestion(req.params.id))(req, reply),
  );

  app.post<{ Params: { id: string }; Body: { value?: string; status?: 'accepted' | 'edited' } }>(
    '/api/questions/:id/set',
    (req, reply) => wrap(() => setAnswer(req.params.id, req.body?.value ?? '', req.body?.status ?? 'edited'))(req, reply),
  );

  // ── Brain ──
  app.get('/api/brain', async () => ({ stats: brainStats(), entries: listBrain() }));

  // ── Privacy audit ──
  app.get('/api/privacy/calls', async () =>
    getDb().prepare(`SELECT id, ts, stage, model, entity_stats_json, duration_ms, input_tokens, output_tokens, ok FROM ai_calls ORDER BY ts DESC LIMIT 100`).all(),
  );
  app.get<{ Params: { id: string } }>('/api/privacy/calls/:id', (req, reply) =>
    wrap(() => {
      const r = getDb().prepare(`SELECT * FROM ai_calls WHERE id = ?`).get(req.params.id);
      if (!r) throw new Error('Call not found');
      return r;
    })(req, reply),
  );
}
