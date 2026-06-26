# DealProof — one-command container.
# Builds the React frontend, seeds the demo DB on first run, serves API + UI.
FROM node:20-bookworm

WORKDIR /app

# System deps: build tools for native modules (better-sqlite3) + Python for the
# optional vector-PDF chart extractor (tools/extract_pdf_chart.py).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip build-essential \
  && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages pymupdf || true

# Install deps first (better layer caching)
COPY package*.json ./
RUN npm install
COPY web/package*.json ./web/
RUN npm --prefix web install

# App source + frontend build
COPY . .
RUN npm --prefix web run build

ENV KYC_HOST=0.0.0.0 \
    KYC_PORT=3000 \
    KYC_DB_PATH=/app/data/kyc.db

EXPOSE 3000

# Seed only if the DB doesn't exist yet, then start the server.
CMD ["sh", "-c", "[ -f \"$KYC_DB_PATH\" ] || npm run seed; npm run dev"]
