# Digital Asset CMS

A CMS for managing digital assets with Google Drive integration and Shopify sync.

## Stage 0 — Project Scaffold

This is the initial scaffold. See later stages for full implementation.

## Structure

- `backend/` — Fastify API server (Node.js / TypeScript)
- `frontend/` — React SPA (Vite / TypeScript / Tailwind)
- `docker-compose.yml` — Production services
- `docker-compose.test.yml` — Test database services
- `Caddyfile` — Reverse proxy config
- `.env.example` — Environment variable template

## Getting Started

```bash
cp .env.example .env
# Fill in required values in .env

cd backend && npm install
cd ../frontend && npm install

# Start test services
docker compose -f docker-compose.test.yml up -d

# Run migrations
cd backend && npm run migrate

# Dev
npm run dev          # backend
cd ../frontend && npm run dev  # frontend
```
