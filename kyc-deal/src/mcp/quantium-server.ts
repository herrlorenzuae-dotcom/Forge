/**
 * Quantium MCP server. Exposes the client's corporate structure and a
 * currency/Aktualität check as MCP tools, over stdio, so any MCP client
 * (Claude Desktop, an agent, or KYC Deal's own connector layer) can call
 * them. The mock implementation serves the bundled Halcyon snapshot; point
 * the connector underneath at the real Quantium API to go live.
 *
 *   npm run mcp:quantium
 *
 * Tools:
 *   - get_structure(clientRef)            → entities, edges, UBOs, registry facts
 *   - verify_currency(clientRef, staleDays?) → per-entity as-of + stale flags
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MockQuantiumConnector } from '../connectors/quantium.js';

const connector = new MockQuantiumConnector();
const server = new McpServer({ name: 'quantium', version: '0.1.0' });

server.registerTool(
  'get_structure',
  {
    title: 'Get corporate structure',
    description: "Return the client's full corporate structure: entities, ownership edges, ultimate beneficial owners, and registry attributes.",
    inputSchema: { clientRef: z.string().describe('Client / deal reference, e.g. "project-halcyon".') },
  },
  async ({ clientRef }) => {
    const snapshot = await connector.getStructure(clientRef);
    return { content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }] };
  },
);

server.registerTool(
  'verify_currency',
  {
    title: 'Verify data currency',
    description: 'Check how current each entity record is. Returns the as-of date and age in days per entity, flagging any older than the staleness threshold.',
    inputSchema: {
      clientRef: z.string().describe('Client / deal reference.'),
      staleDays: z.number().optional().describe('Records older than this many days are flagged stale (default 180).'),
    },
  },
  async ({ clientRef, staleDays }) => {
    const report = await connector.verifyCurrency(clientRef, staleDays ?? 180);
    return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
