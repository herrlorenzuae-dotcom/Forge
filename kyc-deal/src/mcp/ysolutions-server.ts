/**
 * YSolutions MCP server. Exposes the softer KYC data layer (contacts, source
 * of wealth, tax/regulatory classifications) as an MCP tool over stdio. The
 * mock serves bundled fixtures; point the connector underneath at the real
 * YSolutions API to go live.
 *
 *   npm run mcp:ysolutions
 *
 * Tools:
 *   - get_data(clientRef) → supplemental, citable attributes keyed by entity
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MockYSolutionsConnector } from '../connectors/ysolutions.js';

const connector = new MockYSolutionsConnector();
const server = new McpServer({ name: 'ysolutions', version: '0.1.0' });

server.registerTool(
  'get_data',
  {
    title: 'Get supplemental KYC data',
    description: 'Return the softer KYC data layer for a client: primary contacts, source of funds and wealth, FATCA/CRS and tax classifications. Keyed by entity reference.',
    inputSchema: { clientRef: z.string().describe('Client / deal reference, e.g. "project-halcyon".') },
  },
  async ({ clientRef }) => {
    const attributes = await connector.getData(clientRef);
    return { content: [{ type: 'text', text: JSON.stringify(attributes, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
