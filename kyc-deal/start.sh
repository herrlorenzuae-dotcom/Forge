#!/usr/bin/env bash
# DealProof — one-command start without Docker.
#   ./start.sh                 # http://localhost:3000
#   KYC_PORT=3100 ./start.sh   # custom port
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (v20+). Install with: brew install node" >&2
  exit 1
fi

echo "→ installing dependencies…"
npm install
npm --prefix web install

echo "→ building the frontend…"
npm --prefix web run build

if [ ! -f "${KYC_DB_PATH:-./data/kyc.db}" ]; then
  echo "→ seeding the demo database…"
  npm run seed
fi

echo "→ starting DealProof on port ${KYC_PORT:-3000}…"
exec npm run dev
