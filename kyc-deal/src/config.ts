/** Environment-backed configuration. Everything has a sane default so the
 *  app runs from a clean clone; the frontier key is the only thing you add. */

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num('KYC_PORT', 3000),
  host: process.env.KYC_HOST ?? '127.0.0.1',
  dbPath: process.env.KYC_DB_PATH ?? './data/kyc.db',
  staleDays: num('KYC_STALE_DAYS', 180),
  sendJurisdiction: process.env.KYC_SEND_JURISDICTION === '1',
  connector: (process.env.KYC_CONNECTOR ?? 'mock') as 'mock',
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.KYC_MODEL ?? 'claude-opus-4-8',
  },
} as const;
