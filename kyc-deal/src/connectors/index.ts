/** Resolve the configured connector set. Today only 'mock' exists; this is
 *  the single place to add a real Quantium / YSolutions implementation. */

import { config } from '../config.js';
import type { Connectors } from './types.js';
import { MockQuantiumConnector } from './quantium.js';
import { MockYSolutionsConnector } from './ysolutions.js';

let _connectors: Connectors | null = null;

export function getConnectors(): Connectors {
  if (_connectors) return _connectors;
  switch (config.connector) {
    case 'mock':
    default:
      _connectors = {
        quantium: new MockQuantiumConnector(),
        ysolutions: new MockYSolutionsConnector(),
      };
  }
  return _connectors;
}

/** Tests can inject fakes. */
export function setConnectors(c: Connectors | null): void {
  _connectors = c;
}

export * from './types.js';
