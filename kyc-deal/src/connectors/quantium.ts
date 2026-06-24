/** Quantium connector — corporate structure + currency verification.
 *  The mock implementation serves the bundled Halcyon snapshot. A real
 *  implementation would call Quantium's API (or an MCP client) here. */

import { config } from '../config.js';
import { today } from '../db/db.js';
import type { CurrencyReport, StructureConnector, StructureSnapshot } from './types.js';
import { QUANTIUM_STRUCTURE, currencyItems } from './mock-data.js';

export class MockQuantiumConnector implements StructureConnector {
  readonly name = 'quantium (mock)';

  async getStructure(_clientRef: string): Promise<StructureSnapshot> {
    // Deep clone so callers can't mutate the bundled fixture.
    return JSON.parse(JSON.stringify(QUANTIUM_STRUCTURE)) as StructureSnapshot;
  }

  async verifyCurrency(_clientRef: string, staleDays = config.staleDays): Promise<CurrencyReport> {
    const checkedAt = today();
    const items = currencyItems(checkedAt, staleDays);
    return {
      checkedAt,
      staleDays,
      items,
      staleCount: items.filter((i) => i.stale).length,
    };
  }
}
