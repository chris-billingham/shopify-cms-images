# Digital Asset CMS

A self-hosted Content Management System for managing digital assets — primarily images, videos, and documents — tied to product data. Uses Google Team Drive as the file store, PostgreSQL for metadata and search, and integrates bidirectionally with Shopify.

---

## Contents

- [Quick Start](#quick-start)
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Running in Production](#running-in-production)
- [Running in Development](#running-in-development)
- [Running Tests](#running-tests)
- [API Reference](#api-reference)
- [User Guide](#user-guide)
- [Architecture](#architecture)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

Get the CMS running on a fresh server in under 10 minutes.

### 1. Clone and configure

```bash
git clone <repo-url> digital-asset-cms
cd digital-asset-cms/digital-asset-cms
cp .env.example .env
```

Open `.env` and fill in the six required values:

```bash
# The JSON key for your Google service account (see Prerequisites)
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'
GOOGLE_TEAM_DRIVE_ID=your_team_drive_id_here

# Your Shopify Custom App credentials
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_API_TOKEN=shpat_xxxxx
SHOPIFY_WEBHOOK_SECRET=your_webhook_secret

# A 64-character random string — generate with: openssl rand -hex 32
JWT_SECRET=your_64_char_secret_here

# Your domain (or localhost for local testing)
APP_URL=https://cms.yourdomain.com
FRONTEND_ORIGIN=https://cms.yourdomain.com
DB_PASSWORD=change_this_to_a_strong_password

# Email address that will become the first admin account
SEED_ADMIN_EMAIL=admin@yourdomain.com
```

### 2. Start the stack

```bash
docker compose up -d
```

This starts six services: Caddy (reverse proxy), app (API), worker (background jobs), frontend, PostgreSQL, and Redis. Database migrations run automatically on first boot.

### 3. Seed the admin account

Create the admin user and set a password in one step:

```bash
docker compose exec app node dist/scripts/seed-admin.js --email admin@yourdomain.com --password yourpassword
```

Omit `--password` if you want Google OAuth only. The script does nothing if users already exist.

### 4. Open the CMS

Navigate to `https://cms.yourdomain.com` (or `http://localhost` if running locally without TLS). Log in with the admin email.

---

## Overview

### What it does

- **Asset library:** Upload, browse, search, preview, and download images, videos, documents, and text files. Files are stored on Google Drive; the CMS stores only metadata.
- **Tagging:** Attach arbitrary key-value tags to any asset (e.g. `colour: Navy`, `season: AW26`, `sku: POLO-001`). No schema changes required for new tag keys.
- **Search:** Full-text and faceted search across file names, tag values, product titles, and SKUs. Results ranked by relevance.
- **Shopify sync:** Pull product catalogues (metadata and optionally images) from Shopify. Push assets to Shopify as product images.
- **Versioning:** Replace an asset's file while preserving its tags, product links, and history.
- **Background jobs:** Bulk downloads as ZIP archives, Shopify sync, Drive watcher — all run as background jobs with progress tracking.
- **Real-time updates:** WebSocket channel notifies all connected users of changes and delivers job progress to the user who initiated a job.

### Stack

| Layer | Technology |
|-------|-----------|
| Reverse proxy | Caddy 2 (automatic HTTPS) |
| API | Node.js 20 + Fastify 5 |
| Background jobs | BullMQ + Redis 7 |
| Database | PostgreSQL 16 + pg_trgm |
| File store | Google Team Drive |
| Frontend | React 18 + Vite + Tailwind |

---

## Prerequisites

Before running the CMS you need accounts and credentials for three external services.

### Google Service Account

The CMS accesses Google Drive using a service account, not per-user OAuth.

1. Open [Google Cloud Console](https://console.cloud.google.com) → IAM & Admin → Service Accounts.
2. Create a service account. Give it a descriptive name (e.g. `cms-drive-access`).
3. Create a JSON key for the account. Download it.
4. Add the service account's email address (e.g. `cms-drive-access@your-project.iam.gserviceaccount.com`) as a **Content Manager** on your Team Drive.
5. Encode the JSON key for the `.env` file. Either:
   - Paste the entire JSON object directly: `GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'`
   - Or base64-encode it: `GOOGLE_SERVICE_ACCOUNT_KEY=$(base64 < service-account-key.json)`

**Find your Team Drive ID:** Open the Team Drive in Google Drive. The ID is the long string at the end of the URL: `https://drive.google.com/drive/u/0/folders/YOUR_TEAM_DRIVE_ID`.

Required API scopes (enabled automatically for service accounts):
```
https://www.googleapis.com/auth/drive
```

### Shopify Custom App

1. In your Shopify Admin, go to Settings → Apps and sales channels → Develop apps.
2. Create a new app. Under **Admin API access**, grant these scopes:
   - `read_products`, `write_products`
   - `read_product_listings`
3. Install the app. Copy the **Admin API access token** (`shpat_...`).
4. For webhooks: go to Settings → Notifications → Webhooks and note the **webhook signing secret**, or generate one when creating webhooks.

### Google OAuth (optional, for sign-in with Google)

1. In Google Cloud Console → APIs & Services → Credentials, create an OAuth 2.0 Client ID.
2. Set the authorised redirect URI to `https://cms.yourdomain.com/api/auth/google/callback`.
3. Copy the Client ID and Client Secret into `.env`.

If you skip this, users log in with email + password only. The admin password is set via the CLI above.

---

## Configuration

All configuration is via environment variables in `.env`. Copy `.env.example` to get started.

### Required

| Variable | Description |
|----------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Service account JSON key (string or base64) |
| `GOOGLE_TEAM_DRIVE_ID` | ID of the Team Drive to use as file store |
| `SHOPIFY_STORE_DOMAIN` | e.g. `your-store.myshopify.com` |
| `SHOPIFY_ADMIN_API_TOKEN` | Shopify Custom App admin API token |
| `SHOPIFY_WEBHOOK_SECRET` | Used to verify incoming Shopify webhooks |
| `JWT_SECRET` | Random 64-character string — never reuse between environments |
| `APP_URL` | Full URL the app is served from, e.g. `https://cms.yourdomain.com` |
| `FRONTEND_ORIGIN` | Same as `APP_URL` unless frontend is on a separate domain |
| `DB_PASSWORD` | PostgreSQL password (also used in `DATABASE_URL`) |
| `SEED_ADMIN_EMAIL` | Email for the auto-created admin on first boot |

### Optional (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_OAUTH_CLIENT_ID` | — | Enable Google sign-in |
| `GOOGLE_OAUTH_CLIENT_SECRET` | — | Enable Google sign-in |
| `DATABASE_URL` | `postgresql://cms_user:password@db:5432/cms` | Override if using external DB |
| `REDIS_URL` | `redis://redis:6379` | Override if using external Redis |
| `NODE_ENV` | `production` | Set to `development` for verbose logging |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `MAX_IMAGE_SIZE_MB` | `100` | Max upload size for images |
| `MAX_VIDEO_SIZE_MB` | `1024` | Max upload size for video |
| `MAX_TEXT_SIZE_MB` | `10` | Max upload size for text/CSV |
| `MAX_DOCUMENT_SIZE_MB` | `50` | Max upload size for PDFs |
| `BULK_DOWNLOAD_MAX_ASSETS` | `500` | Max assets per bulk download request |
| `BULK_DOWNLOAD_MAX_SIZE_GB` | `5` | Max total estimated size for bulk download |
| `BULK_DOWNLOAD_RETENTION_HOURS` | `24` | How long ZIP files are kept |
| `AUDIT_LOG_RETENTION_DAYS` | `180` | How long audit entries are kept |
| `SEARCH_WEIGHT_SKU` | `10` | Relevance weight for SKU matches |
| `SEARCH_WEIGHT_PRODUCT_TITLE` | `5` | Relevance weight for product title matches |
| `SEARCH_WEIGHT_TAG_VALUE` | `3` | Relevance weight for tag value matches |
| `SEARCH_WEIGHT_FILE_NAME` | `1` | Relevance weight for file name matches |

### Caddyfile

Edit `Caddyfile` to set your domain:

```
cms.yourdomain.com {
    handle /api/ws { reverse_proxy app:3000 }
    handle /api/*  { reverse_proxy app:3000 }
    handle         { reverse_proxy frontend:80 }
    ...
}
```

Caddy handles TLS automatically via Let's Encrypt. For local development, remove the domain line to use Caddy's auto-generated localhost certificate:

```
:443 {
    tls internal
    ...
}
```

---

## Running in Production

### Start

```bash
docker compose up -d
```

Migrations run automatically on the `app` container startup. The admin user is seeded on first boot if `SEED_ADMIN_EMAIL` is set and no users exist.

### Update

```bash
git pull
docker compose build
docker compose up -d
```

Migrations are applied automatically on startup. No manual migration step required.

### Check health

```bash
# Service status
docker compose ps

# Application health (checks DB, Redis, Drive)
curl https://cms.yourdomain.com/api/health

# Logs
docker compose logs -f app
docker compose logs -f worker
```

### Stop

```bash
docker compose down           # stop, keep volumes
docker compose down -v        # stop and delete all data (destructive)
```

### Seed admin on an already-running stack

```bash
docker compose exec app node dist/scripts/seed-admin.js --email admin@yourdomain.com --password yourpassword
```

Omit `--password` to create an account that can only sign in via Google OAuth. The script exits without changes if users already exist.

---

## Running in Development

For local development without Docker:

### 1. Start test services (PostgreSQL + Redis only)

```bash
cd digital-asset-cms
docker compose -f docker-compose.test.yml up -d
```

This starts PostgreSQL on port `5433` and Redis on port `6380` in isolated containers.

### 2. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 3. Configure environment

Create `backend/.env` (or export variables) with the test database values:

```bash
DATABASE_URL=postgresql://cms_user:password@localhost:5433/cms_test
REDIS_URL=redis://localhost:6380
JWT_SECRET=dev-secret-at-least-32-characters-long
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"dev"}'
GOOGLE_TEAM_DRIVE_ID=your-drive-id
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_API_TOKEN=shpat_...
SHOPIFY_WEBHOOK_SECRET=dev-webhook-secret
FRONTEND_ORIGIN=http://localhost:5173
APP_URL=http://localhost:3000
SEED_ADMIN_EMAIL=admin@dev.example.com
NODE_ENV=development
```

### 4. Run migrations

```bash
cd backend && npm run migrate
```

### 5. Start the backend and frontend

In two separate terminals:

```bash
# Terminal 1 — API server (port 3000, hot reload)
cd backend && npm run dev

# Terminal 2 — Frontend (port 5173, HMR)
cd frontend && npm run dev
```

Open `http://localhost:5173`.

### 6. Start the background worker (optional)

The worker processes background jobs (bulk downloads, Shopify sync, Drive watcher, MV refresh):

```bash
cd backend && npm run worker
```

---

## Running Tests

Tests use the test Docker services (PostgreSQL on `5433`, Redis on `6380`).

### Start test services

```bash
docker compose -f docker-compose.test.yml up -d
```

### Run all tests

```bash
cd backend && npm test
```

### Run specific test suites

```bash
# Unit tests only
cd backend && npm run test:unit

# Integration tests only
cd backend && npm run test:integration

# End-to-end smoke tests (Stage 15 test gate)
cd backend && npx vitest run tests/e2e

# Frontend tests
cd frontend && npm test
```

### Test structure

```
backend/tests/
  unit/           — Service-layer unit tests (Drive, Shopify, auth, audit)
  integration/    — HTTP integration tests per feature area (auth, assets, search, ...)
  e2e/            — End-to-end smoke tests covering full user workflows
  helpers/        — Shared test utilities (app setup, DB helpers, fixtures, mocks)
```

Integration and E2E tests run against a real PostgreSQL instance. All tests are isolated — each suite cleans up after itself. There is no per-test transaction rollback; tests insert and delete their own data.

---

## API Reference

All endpoints require `Authorization: Bearer <access_token>` unless noted. Tokens are obtained via the auth endpoints.

### Authentication

```
POST /api/auth/login
  Body: { email, password }
  Returns: { accessToken }  +  Set-Cookie: refresh_token (HttpOnly)

POST /api/auth/refresh
  Cookie: refresh_token
  Returns: { accessToken }  +  new Set-Cookie: refresh_token

POST /api/auth/logout
  Invalidates the current refresh token.
```

### Assets

```
GET    /api/assets
  Query: status, limit, offset
  Returns: { assets, total }

GET    /api/assets/check-duplicate
  Query: fileName (required), fileSize (required), md5 (optional)
  Returns: { duplicate: bool, asset: Asset | null }

GET    /api/assets/:id
  Returns: Asset

POST   /api/assets
  Auth: editor | admin
  Body: multipart/form-data — file field + optional tags JSON field
  Headers: Idempotency-Key (optional, prevents duplicate uploads on retry)
  Returns 201: Asset

PATCH  /api/assets/:id
  Auth: editor | admin
  Body: { tags?, fileName?, updatedAt (required for optimistic lock) }
  Returns 200: Asset
  Returns 409: if updatedAt does not match current value (concurrent edit)

DELETE /api/assets/:id
  Auth: admin
  Soft-deletes the asset (sets status to "deleted")

POST   /api/assets/:id/replace
  Auth: editor | admin
  Body: multipart/form-data — file field
  Creates a new asset version. Old asset is archived.
  Returns 201: new Asset

GET    /api/assets/:id/versions
  Returns: { versions: Asset[] }  — ordered oldest to newest

GET    /api/assets/:id/download
  Streams the file from Google Drive.

POST   /api/assets/bulk-download
  Auth: editor | admin
  Body: { asset_ids: string[] }  — max 500 IDs, max 5 GB estimated total
  Returns 202: { job_id, asset_count, total_size_bytes }
  Poll GET /api/jobs/:id for completion, then GET /api/jobs/:id/download for ZIP.
```

### Search

```
GET /api/search
  Query:
    q           — free text (fuzzy, trigram similarity)
    tags[key]   — tag filter, e.g. tags[colour]=Navy
    sku         — exact SKU match
    category    — exact category match
    type        — asset_type filter: image | video | text | document
    status      — default: active  (also: archived)
    sort        — relevance | created_at | file_name  (default: relevance when q present)
    order       — asc | desc  (default: desc)
    page        — default: 1
    limit       — default: 50, max: 200
    facets      — true to include tag and type counts for current filters

  Returns: { assets, total, page, limit, facets? }

  Note: each asset in the response has field asset_id (not id).
```

**Example searches:**

```bash
# Free text
GET /api/search?q=navy+polo

# Tag filter (exact)
GET /api/search?tags[colour]=Navy&tags[season]=AW26

# Combined
GET /api/search?q=polo&tags[colour]=Navy&type=image&facets=true

# All images, newest first
GET /api/search?type=image&sort=created_at&order=desc
```

### Tags

```
GET /api/tags/keys
  Returns: { keys: string[] }  — all distinct tag keys in use

GET /api/tags/values?key=colour
  Returns: { values: string[] }  — distinct values for the given key

GET /api/tags/facets
  Returns: { facets: { [key]: { [value]: count } } }
```

### Products

```
GET    /api/products
  Query: q (search), limit, offset
  Returns: { products, total }

GET    /api/products/:id
  Returns: Product with variants and linked assets

GET    /api/products/:id/variants
  Returns: { variants }

POST   /api/products/:id/assets
  Auth: editor | admin
  Body: { assetId, variantId? (null = product-level), role? (default: gallery), sortOrder? }
  Returns 201: asset_products link

DELETE /api/products/:id/assets/:linkId
  Auth: editor | admin
  Removes the link (does not delete the asset)

PATCH  /api/products/:id/assets/:linkId
  Auth: editor | admin
  Body: { role?, sortOrder? }
```

### Shopify

```
POST /api/shopify/sync-products
  Auth: editor | admin
  Starts a background job to pull product metadata from Shopify.
  Returns 202: { job_id }

POST /api/shopify/import-images
  Auth: admin
  Starts a background job to import Shopify product images to Google Drive.
  Returns 202: { job_id }

POST /api/shopify/push/:assetId
  Auth: admin
  Pushes the asset to the Shopify product it is linked to.
  Returns: { success, shopify_image_id }

POST /api/shopify/webhooks
  No auth — verified via HMAC-SHA256 signature (X-Shopify-Hmac-Sha256 header)
  Handles: products/create, products/update, products/delete

GET  /api/shopify/status
  Returns: { last_sync_at, recent_jobs }

POST /api/shopify/reconcile
  Auth: admin
  Compares CMS products against Shopify and fixes discrepancies.
  Returns 202: { job_id }
```

### Background Jobs

```
GET /api/jobs/:id
  Returns: { id, type, status, progress, result, error, created_at, updated_at }
  status: pending | running | completed | failed

GET /api/jobs/:id/download
  Streams the ZIP file for a completed bulk-download job.
  Returns 400 if job is not yet completed.
```

### Health

```
GET /api/health
  Returns: {
    status: "healthy" | "degraded" | "unhealthy",
    checks: {
      database: { status, latency_ms },
      redis:    { status, latency_ms },
      drive:    { status },
      shopify:  { status }
    }
  }
```

### Rate limits

| Endpoint group | Limit |
|----------------|-------|
| `POST /api/auth/login`, `/refresh` | 10 req/min per IP |
| `GET /api/search` | 30 req/min per user |
| `POST /api/assets/bulk-download` | 5 req/min per user |
| All other endpoints | 120 req/min per user |

Exceeded limits return `429 Too Many Requests` with a `Retry-After` header.

### Error format

All errors follow this structure:

```json
{
  "error": {
    "code": "ASSET_NOT_FOUND",
    "message": "Asset abc-123 not found or has been deleted.",
    "details": {}
  }
}
```

Common error codes: `INVALID_CREDENTIALS`, `ACCOUNT_DEACTIVATED`, `ASSET_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `CONFLICT` (409 optimistic lock), `DUPLICATE_LINK`, `VALIDATION_ERROR`, `NO_FILE`, `MIME_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE`, `DRIVE_STORAGE_FULL`.

### WebSocket

Connect with a valid access token:

```
wss://cms.yourdomain.com/api/ws?token=<access_token>
```

The server sends JSON messages:

```jsonc
// Job progress (sent to the user who initiated the job)
{ "type": "job_progress", "job_id": "...", "progress": 42, "status": "running" }

// Job complete
{ "type": "job_complete", "job_id": "...", "status": "completed", "result": {...} }

// Asset changed (broadcast to all users)
{ "type": "asset_changed", "asset_id": "...", "action": "upload" | "tag_change" | "delete" }

// Admin alert (sent to admin connections only)
{ "type": "admin_alert", "severity": "warning" | "error", "message": "..." }
```

The client must send a token refresh before the 15-minute access token expires:

```json
{ "type": "token_refresh", "token": "<new_access_token>" }
```

If no refresh is sent within 60 seconds of token expiry, the server closes the connection with code `4001`.

---

## User Guide

### Roles

| Capability | Viewer | Editor | Admin |
|-----------|--------|--------|-------|
| Browse, search, preview, download | Yes | Yes | Yes |
| Upload assets | — | Yes | Yes |
| Add/edit/remove tags | — | Yes | Yes |
| Link assets to products | — | Yes | Yes |
| Delete assets | — | — | Yes |
| Push to Shopify | — | — | Yes |
| Manage users | — | — | Yes |
| View audit log | — | — | Yes |
| Configure integrations | — | — | Yes |

### Uploading assets

1. Click **Upload** in the top bar or drag files onto the library grid.
2. Before uploading, optionally select a product and add tags — these are applied to all files in the batch.
3. The system checks each file for duplicates (by name + size, or file hash). If a match is found, you can skip, replace (creates a new version), or upload as a separate asset.
4. Files are streamed directly to Google Drive. A progress bar tracks each file.
5. After upload, the asset appears in the library immediately (optimistic update). Tags are editable inline.

**Accepted file types and size limits:**

| Type | Accepted formats | Max size |
|------|-----------------|----------|
| Image | JPEG, PNG, WebP, GIF, SVG, TIFF | 100 MB |
| Video | MP4, QuickTime, WebM, AVI | 1 GB |
| Text | Plain text, Markdown, HTML, CSV | 10 MB |
| Document | PDF | 50 MB |

### Tagging

Tags are free-form key-value pairs. Common tag keys: `colour`, `season`, `sku`, `category`, `shoot_location`. There is no fixed schema — use any keys your team agrees on.

To add or edit tags on an asset, open its detail panel and click any tag chip or the **+** button. Key and value autocomplete suggest existing keys and values used across the library.

Tag values are searchable immediately after saving (the search index refreshes automatically).

### Searching

The search bar at the top of the library supports:

- **Free text** — matches against file names, product titles, SKUs, and tag values simultaneously. Fuzzy matching handles minor typos.
- **Tag filters** — expand tag keys in the left sidebar to filter by specific values (e.g. all assets tagged `colour: Navy`).
- **Asset type filter** — Image, Video, Text, Document buttons in the sidebar.
- **Sort** — Relevance (default when searching), Newest, Filename.

Search results are ranked: SKU matches score highest, then product title, then tag values, then file name.

### Linking assets to products

1. Open an asset's detail panel.
2. In the **Linked Products** section, click **Link to product**.
3. Search for a product by name.
4. Optionally select a specific variant (e.g. a colour swatch for one variant).
5. Set a role: `hero` (primary product image), `gallery`, or `swatch`.
6. Drag to reorder linked assets within a product.

Assets can be linked to multiple products and multiple variants. The same asset can serve as `hero` for one product and `gallery` for another.

### Replacing an asset (versioning)

To replace an asset's file while keeping its metadata and product links:

1. Open the asset's detail panel.
2. Click **Replace** and upload the new file.
3. The new file becomes the active version. The old file is archived (still accessible via version history).
4. All product links, tags, and sort order are transferred to the new version automatically.

### Bulk download

1. Select multiple assets using the checkboxes (or select all matching a filter).
2. Click **Download selected** in the bulk action bar.
3. A background job is created. You receive a WebSocket notification when the ZIP is ready.
4. Click the notification (or go to Jobs) to download the ZIP. Files are available for 24 hours.

Limit: 500 assets per request, 5 GB estimated total size.

### Shopify sync

**To pull product metadata from Shopify:**
Go to **Products** → click **Sync Products**. This imports product names, categories, vendors, variants, and SKUs. It does not import product images.

**To import Shopify product images (one-time):**
In Admin → Shopify, click **Import Images**. This downloads existing Shopify product images to Google Drive and links them to the corresponding CMS products.

**To push an asset to Shopify:**
Open the asset's detail panel → click **Push to Shopify**. The asset must be linked to a product that has been synced from Shopify (has a `shopify_id`). Admin role required.

**Webhooks:** The CMS receives automatic updates from Shopify when products are created, updated, or deleted. The webhook URL to register in Shopify is:

```
https://cms.yourdomain.com/api/shopify/webhooks
```

Topics to register: `products/create`, `products/update`, `products/delete`.

### Drive watcher

The CMS polls Google Drive every 5 minutes for changes. Files added directly to the Team Drive (outside the CMS) appear in the library as untagged assets. Renamed or moved files are reflected automatically. Files trashed on Drive are archived in the CMS.

To tag a batch of Drive-scanned files, filter the library by **Uploaded by: Drive** and use bulk tag.

---

## Architecture

### Service layout

```
Caddy (443/80)
  ├── /api/ws  →  app:3000  (WebSocket)
  ├── /api/*   →  app:3000  (REST API)
  └── /*       →  frontend:80  (React SPA)

app:3000        Fastify API server
worker          BullMQ worker (same image, different entrypoint)
db:5432         PostgreSQL 16
redis:6379      Redis 7
```

### Data storage

| Data | Where |
|------|-------|
| File content | Google Team Drive |
| Asset metadata, tags | PostgreSQL `assets` table |
| Product & variant data | PostgreSQL `products`, `product_variants` |
| Product–asset links | PostgreSQL `asset_products` |
| Search index | PostgreSQL `asset_search_mv` (materialised view) |
| User accounts, sessions | PostgreSQL `users`, `refresh_tokens` |
| Background job state | PostgreSQL `background_jobs` |
| Job queue | Redis (BullMQ) |
| Idempotency keys | Redis |

### Search architecture

Search runs against `asset_search_mv`, a materialised PostgreSQL view that pre-joins assets, products, variants, and tags into one row per asset. It uses trigram similarity (`pg_trgm`) for fuzzy text matching against a `search_text` column that concatenates file name, product titles, SKUs, and tag values.

The view is refreshed:
- Immediately after each write operation (upload, tag change, product link)
- Every 60 seconds as a background backstop
- After bulk operations complete

For the user, this means search results reflect their changes within a fraction of a second in most cases. The frontend also applies optimistic updates so changes appear in the UI before the server confirms.

### Background jobs

| Job | Trigger | Description |
|-----|---------|-------------|
| `bulk_download` | User request | Streams files from Drive, creates a ZIP |
| `shopify_sync_products` | User request or schedule | Pulls product metadata from Shopify |
| `shopify_import_images` | User request | Imports Shopify product images to Drive |
| `shopify_reconcile` | Daily schedule | Compares CMS vs Shopify, fixes gaps |
| `drive_watcher` | Every 5 minutes | Polls Drive Changes API for new/renamed/moved/deleted files |
| `mv_refresh` | Every 60 seconds | Refreshes the search materialised view |
| `job_cleanup` | Daily | Removes completed/failed jobs past retention |
| `audit_cleanup` | Daily | Removes audit entries past retention |
| `orphan_cleanup` | Hourly | Detects Drive files with no asset record |

### Authentication flow

1. User submits email + password (or Google OAuth token).
2. Server returns a short-lived access token (JWT, 15 min) and a long-lived refresh token (HttpOnly cookie, 7 days).
3. Refresh tokens are single-use. Each refresh call issues a new pair. Reusing an old token invalidates all tokens for that user (theft detection).
4. The frontend transparently refreshes the access token on 401 responses.

---

## Operations

### Viewing logs

```bash
docker compose logs -f app       # API server
docker compose logs -f worker    # Background worker
docker compose logs -f db        # PostgreSQL
```

### Database backup

Full backups run automatically every 6 hours (configure via the `backup-sync` service in `docker-compose.yml`). WAL archiving is also enabled for point-in-time recovery.

To take a manual backup:

```bash
docker compose exec db pg_dump -U cms_user cms | gzip > backup-$(date +%Y%m%d-%H%M%S).sql.gz
```

To restore:

```bash
gunzip -c backup-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T db psql -U cms_user cms
```

### Running database migrations manually

Migrations run automatically on startup. To run them manually:

```bash
docker compose exec app npm run migrate
```

To check migration status:

```bash
docker compose exec app npx knex --knexfile knexfile.ts migrate:status
```

### Scaling

The architecture supports horizontal scaling of the `app` and `worker` services behind a load balancer. Ensure:
- All instances share the same PostgreSQL and Redis.
- Sessions are stateless (JWT), so no sticky sessions are needed.
- File streaming goes via Drive (no local disk state on the app containers).

For a team of up to 10 users and 50,000 assets, a single-server Compose stack is sufficient.

### Admin seeding

The admin seeding is a one-time operation. It runs automatically on first boot if `SEED_ADMIN_EMAIL` is set and the `users` table is empty. It does nothing on subsequent boots.

To force a new admin seed (e.g. after wiping the database):

```bash
docker compose exec app node dist/scripts/seed-admin.js --email admin@yourdomain.com --password yourpassword
```

---

## Troubleshooting

### Stack won't start

```bash
docker compose ps          # Check which services are healthy/unhealthy
docker compose logs db     # Usually a volume permission or config issue
docker compose logs app    # Check for missing env vars or migration errors
```

**Common causes:**
- `APP_URL` or `FRONTEND_ORIGIN` missing the URL scheme — values must be full URLs including `http://` or `https://` (e.g. `http://localhost`, not just `localhost`). The app will fail to start with a `ZodError` if these are bare hostnames.
- `NODE_ENV` set to `development` in a Docker deployment — the app expects `NODE_ENV=production` so it looks for compiled migrations in `dist/src/db/migrations`. With `development` it looks in `src/db/migrations` which does not exist in the image.
- Missing or malformed `GOOGLE_SERVICE_ACCOUNT_KEY` — ensure it's valid JSON.
- `DB_PASSWORD` mismatch between `.env` and an existing volume — either update the password or `docker compose down -v` to wipe volumes.
- Port 80 or 443 already in use — check with `lsof -i :80`.

### Search returns no results

1. Check that the materialised view has been populated: `docker compose exec db psql -U cms_user cms -c "SELECT COUNT(*) FROM asset_search_mv;"`
2. If count is 0 but assets exist, refresh manually: `docker compose exec db psql -U cms_user cms -c "REFRESH MATERIALIZED VIEW CONCURRENTLY asset_search_mv;"`
3. Ensure the `pg_trgm` extension is installed: `SELECT * FROM pg_extension WHERE extname = 'pg_trgm';`

### Google Drive errors

- **`GOOGLE_SERVICE_ACCOUNT_KEY` parsing error:** The value must be valid JSON. If base64-encoded, the app will decode it automatically. Try: `echo "$GOOGLE_SERVICE_ACCOUNT_KEY" | python3 -m json.tool` to validate.
- **403 from Drive API:** The service account has not been added to the Team Drive. Add its email as a Content Manager in Google Drive → Manage members.
- **`DRIVE_STORAGE_FULL`:** The Team Drive has run out of storage. Free space in Drive or contact your Google Workspace admin.

### Shopify sync fails

- Verify `SHOPIFY_STORE_DOMAIN` has no `https://` prefix (just `your-store.myshopify.com`).
- Check the Admin API token has `read_products` and `write_products` scopes.
- Check recent sync jobs in Admin → Shopify for error details.

### Webhook verification fails

- The `SHOPIFY_WEBHOOK_SECRET` must match the secret used when registering the webhook in Shopify.
- Webhook requests must reach the server with the raw (unmodified) body — do not use a body-parsing middleware upstream that might alter the payload.

### Concurrent edit conflicts (409)

The frontend shows: *"This asset has been modified by another user."* Click **Refresh** to reload the latest state and reapply your changes. This is expected behaviour when two users edit the same asset simultaneously.

### WebSocket disconnects

WebSocket connections close after 15 minutes if the access token is not refreshed in-band. The frontend handles this automatically with an exponential backoff reconnect. If you see persistent disconnects, check that the `token_refresh` message is being sent before token expiry.
