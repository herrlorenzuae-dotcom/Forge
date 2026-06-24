/** YSolutions connector — the softer KYC data layer (contacts, source of
 *  wealth, tax/regulatory classifications). Mock serves bundled fixtures. */

import type { DataConnector, RawAttribute } from './types.js';
import { YSOLUTIONS_ATTRIBUTES } from './mock-data.js';

export class MockYSolutionsConnector implements DataConnector {
  readonly name = 'ysolutions (mock)';

  async getData(_clientRef: string): Promise<RawAttribute[]> {
    return JSON.parse(JSON.stringify(YSOLUTIONS_ATTRIBUTES)) as RawAttribute[];
  }
}
