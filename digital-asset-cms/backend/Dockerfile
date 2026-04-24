# ── Stage 1: compile TypeScript ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx tsc -p tsconfig.build.json

# ── Stage 2: production dependencies only ────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 3: minimal runtime image ────────────────────────────────────────────
FROM node:20-alpine AS production

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=deps     /app/node_modules ./node_modules
COPY --from=builder  /app/dist         ./dist
COPY package*.json ./

RUN mkdir -p /app/thumbnails && chown appuser:appgroup /app/thumbnails

USER appuser

EXPOSE 3000

# Healthcheck uses wget (pre-installed in alpine)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/src/server.js"]
