import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, setDb, genId } from '../db/db.js';
import { importSnapshot } from './structure.js';
import { buildOrgChart } from './orgchart.js';
import type { StructureSnapshot } from '../connectors/types.js';

const SNAP: StructureSnapshot = {
  entities: [
    { ref: 'p', name: 'Jane Doe', kind: 'individual', role: 'ubo', jurisdiction: 'DE', registration_no: '', incorporation_date: '', status: 'active', as_of: '2026-01-01', notes: '' },
    { ref: 'h', name: 'TopCo GmbH', kind: 'holding', role: 'topco', jurisdiction: 'DE', registration_no: 'HRB 1', incorporation_date: '2020-01-01', status: 'active', as_of: '2026-01-01', notes: '' },
    { ref: 'b', name: 'BidCo Sàrl', kind: 'spv', role: 'acquisition_vehicle', jurisdiction: 'LU', registration_no: 'B 2', incorporation_date: '2026-01-01', status: 'active', as_of: '2026-01-01', notes: '' },
  ],
  edges: [
    { parentRef: 'p', childRef: 'h', pct: 100, kind: 'shares', as_of: '2026-01-01' },
    { parentRef: 'h', childRef: 'b', pct: 80, kind: 'shares', as_of: '2026-01-01' },
  ],
  ubos: [{ entityRef: 'p', basis: 'ownership', pct: 100, pep: false, residence: 'Berlin', as_of: '2026-01-01' }],
  attributes: [],
};

beforeEach(() => {
  setDb(new Database(':memory:'));
  getDb().prepare(`INSERT INTO clients (id, name) VALUES ('c', 'Test')`).run();
  importSnapshot('c', SNAP, []);
});

describe('buildOrgChart', () => {
  it('emits a deterministic mermaid flowchart with all nodes and edges', () => {
    const chart = buildOrgChart('c');
    expect(chart.nodes).toHaveLength(3);
    expect(chart.edges).toHaveLength(2);
    expect(chart.mermaid).toContain('flowchart TD');
    expect(chart.mermaid).toContain('Jane Doe');
    expect(chart.mermaid).toContain('80%');
    // same input → same output
    expect(buildOrgChart('c').mermaid).toBe(chart.mermaid);
  });

  it('orders nodes UBO → topco → bidco', () => {
    const chart = buildOrgChart('c');
    expect(chart.nodes.map((n) => n.role)).toEqual(['ubo', 'topco', 'acquisition_vehicle']);
  });
});
