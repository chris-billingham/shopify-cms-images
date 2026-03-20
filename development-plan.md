# Digital Asset CMS — Claude Code Development Plan

**Version:** 1.0
**Date:** 10 March 2026
**Companion to:** cms-architecture-v3.md

---

## How This Plan Works

This plan is structured as a sequence of **stages**, each containing **tasks** and a **test gate**. Claude Code must execute each stage in order. At the end of every stage, Claude Code runs the full test suite for that stage. If any test fails, Claude Code must fix the failing code and re-run the tests until all pass before moving to the next stage. No stage may be skipped or started out of order.

Every task includes the specific tests that must be written alongside the implementation code. Tests are not an afterthought — they are written first or concurrently with the feature code, and they must pass before the stage is considered complete.

The plan references sections of the architecture document (e.g. §4.5, §5.2) so Claude Code can look up exact specifications when implementing each piece.

---

## Project Structure

```
digital-asset-cms/
├── backend/
│   ├── src/
│   │   ├── app.ts                  # Fastify app setup
│   │   ├── server.ts               # Entry point
│   │   ├── worker.ts               # BullMQ worker entry point
│   │   ├── config/
│   │   │   └── index.ts            # Env var loading, validation, defaults
│   │   ├── db/
│   │   │   ├── connection.ts       # Knex instance
│   │   │   └── migrations/         # Knex migration files
│   │   ├── routes/
│   │   │   ├── assets.ts
│   │   │   ├── auth.ts
│   │   │   ├── health.ts
│   │   │   ├── jobs.ts
│   │   │   ├── products.ts
│   │   │   ├── search.ts
│   │   │   ├── shopify.ts
│   │   │   └── tags.ts
│   │   ├── services/
│   │   │   ├── asset.service.ts
│   │   │   ├── audit.service.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── database.service.ts
│   │   │   ├── drive.service.ts
│   │   │   ├── job.service.ts
│   │   │   ├── product.service.ts
│   │   │   ├── search.service.ts
│   │   │   └── shopify.service.ts
│   │   ├── jobs/
│   │   │   ├── queue.ts            # BullMQ queue definitions
│   │   │   ├── bulk-download.job.ts
│   │   │   ├── drive-watcher.job.ts
│   │   │   ├── mv-refresh.job.ts
│   │   │   ├── orphan-cleanup.job.ts
│   │   │   ├── audit-cleanup.job.ts
│   │   │   ├── job-cleanup.job.ts
│   │   │   └── shopify-reconcile.job.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── rate-limit.ts
│   │   │   └── error-handler.ts
│   │   ├── utils/
│   │   │   ├── idempotency.ts
│   │   │   ├── retry.ts
│   │   │   └── stream.ts
│   │   └── websocket/
│   │       └── handler.ts
│   ├── tests/
│   │   ├── unit/
│   │   ├── integration/
│   │   └── helpers/
│   │       ├── db.ts               # Test DB setup/teardown
│   │       ├── fixtures.ts         # Seed data factories
│   │       └── mocks.ts            # Google Drive & Shopify mocks
│   ├── scripts/
│   │   └── seed-admin.ts
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── knexfile.ts
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── api/
│   │   │   └── client.ts           # Axios/fetch wrapper with interceptor
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── stores/                 # Zustand stores
│   │   └── types/
│   ├── tests/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── docker-compose.yml
├── docker-compose.test.yml
├── Caddyfile
├── .env.example
└── README.md
```

---

## Stage 0 — Project Scaffolding and CI Foundation

**Goal:** Establish the monorepo structure, install all dependencies, configure TypeScript, set up the test runners, and confirm a clean build. Nothing functional is built yet — this stage creates the skeleton that everything else builds on.

### Tasks

**0.1 — Initialise the repository and backend project.**
Create the directory structure shown above. Initialise `backend/package.json` with the following dependencies (referencing Appendix A of the architecture doc): `fastify`, `knex`, `pg`, `googleapis`, `@shopify/shopify-api`, `bullmq`, `ioredis`, `jsonwebtoken`, `argon2`, `archiver`, `bottleneck`, `dotenv`, `zod` (for config validation), `pino` (Fastify's default logger). Dev dependencies: `typescript`, `vitest`, `@types/node`, `@types/pg`, `tsx`, `supertest` (for HTTP integration tests). Configure `tsconfig.json` with strict mode enabled.

**0.2 — Initialise the frontend project.**
Scaffold a Vite + React + TypeScript project in `frontend/`. Install: `react`, `react-dom`, `@tanstack/react-query`, `zustand`, `axios`, `react-router-dom`. UI: `tailwindcss`, shadcn/ui setup. Dev dependencies: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `msw` (Mock Service Worker for API mocking). Configure Vite for proxy to backend during development.

**0.3 — Create docker-compose.yml and docker-compose.test.yml.**
The production `docker-compose.yml` should match §9.1 of the architecture doc exactly (Caddy, app, worker, frontend, db, redis, backup-sync). Create a separate `docker-compose.test.yml` that runs only `db` (PostgreSQL 16 with pg_trgm) and `redis` (Redis 7 Alpine) for integration tests, using different port mappings to avoid conflicts with any local services.

**0.4 — Create the backend config module.**
Build `backend/src/config/index.ts` using `zod` to validate all environment variables listed in §9.2. Every variable should have a defined type, and required variables must cause a clear startup error if missing. Optional variables should have the defaults specified in the architecture doc (e.g. `AUDIT_LOG_RETENTION_DAYS` defaults to 180, search weights default to 10/5/3/1).

**0.5 — Create the Knex connection module and knexfile.**
`backend/src/db/connection.ts` exports a configured Knex instance. `knexfile.ts` defines `development`, `test`, and `production` environments. The test environment should use a separate database name (`cms_test`).

**0.6 — Set up the test infrastructure.**
Configure `vitest` in both backend and frontend. The backend vitest config should support both unit tests (`tests/unit/`) and integration tests (`tests/integration/`). Create `tests/helpers/db.ts` with functions to: start a test transaction before each test, roll it back after each test (so tests don't pollute each other), and run migrations against the test database. Create `tests/helpers/fixtures.ts` with factory functions to create test users, assets, products, and variants with sensible defaults.

### Test Gate 0

Run the following commands. All must succeed:

- `cd backend && npx tsc --noEmit` — TypeScript compiles with zero errors.
- `cd backend && npx vitest run` — The test runner executes (even if there are zero tests, it must not crash).
- `cd frontend && npx tsc --noEmit` — TypeScript compiles with zero errors.
- `cd frontend && npx vitest run` — The test runner executes.
- `docker compose -f docker-compose.test.yml up -d` then verify PostgreSQL and Redis are reachable (e.g. `pg_isready`, `redis-cli ping`), then `docker compose -f docker-compose.test.yml down`.
- The config module, when loaded with valid `.env.example` values, parses without errors. When loaded with a missing required variable (e.g. `DATABASE_URL`), it throws a descriptive `ZodError`.

---

## Stage 1 — Database Schema and Migrations

**Goal:** Implement the full database schema from §4.5 as Knex migrations. Verify every table, column, constraint, index, enum, and the materialised view are created correctly.

### Tasks

**1.1 — Create the migration for enums and core tables.**
A single migration file that creates the enums (`user_role`, `asset_type`, `asset_status`) and all tables: `users`, `products`, `product_variants`, `assets`, `asset_products`, `audit_log`, `refresh_tokens`, `background_jobs`. Follow the exact column definitions, types, defaults, and foreign key constraints from §4.5. Pay particular attention to: `ON DELETE CASCADE` on `product_variants.product_id` and `asset_products.asset_id`/`product_id`, `ON DELETE SET NULL` on `assets.uploaded_by`, `audit_log.user_id`, and `asset_products.variant_id`.

**1.2 — Create the migration for indexes.**
A second migration file that creates all indexes from §4.5: the GIN indexes on `tags` and `file_name` (trigram), the partial unique indexes on `asset_products` (one for rows with `variant_id IS NOT NULL`, one for rows with `variant_id IS NULL`), the trigram index on `products.title`, and all other B-tree indexes.

**1.3 — Create the migration for the materialised view.**
A third migration that creates the `asset_search_mv` materialised view and its indexes (trigram on `search_text`, trigram on `tag_text`, GIN on `tags`, B-tree on `asset_type`, unique on `asset_id`). The view SQL must match §4.5 exactly.

### Tests

**1.T1 — Migration execution test (integration).**
Run all migrations against the test database. Assert: all three migrations complete without error. Then verify each table exists by querying `information_schema.tables`.

**1.T2 — Column verification tests (integration).**
For each table, query `information_schema.columns` and assert that every column exists with the correct data type, nullability, and default value. This is tedious but catches typos in migration files that would cause subtle bugs later.

**1.T3 — Enum verification test (integration).**
Query `pg_type` to confirm `user_role`, `asset_type`, and `asset_status` exist with the correct values.

**1.T4 — Foreign key constraint tests (integration).**
For each foreign key: insert a row referencing a non-existent parent and assert the insert is rejected. Then insert a parent, insert a child, delete the parent, and assert the expected cascade or set-null behaviour.

**1.T5 — Partial unique index tests (integration).**
Insert an `asset_products` row with `variant_id = NULL` for a given `(asset_id, product_id, role)`. Insert a second row with the same three columns and `variant_id = NULL` — assert it is rejected. Insert a row with the same `(asset_id, product_id, role)` but a non-null `variant_id` — assert it succeeds. Insert a second row with the same four columns including the same `variant_id` — assert it is rejected.

**1.T6 — Materialised view test (integration).**
Insert a user, a product with a variant, and an asset with tags. Link the asset to the product via `asset_products`. Refresh the materialised view. Query the view and assert the row contains the correct `file_name`, `product_titles`, `skus`, `tag_text`, and `search_text`.

**1.T7 — Migration rollback test (integration).**
Run `knex migrate:rollback` for all migrations. Assert all tables, indexes, enums, and the materialised view are dropped. Run `knex migrate:latest` again to confirm idempotency.

### Test Gate 1

Run `cd backend && npx vitest run tests/integration/migrations`. All tests must pass. Additionally, run `knex migrate:latest` followed by `knex migrate:rollback --all` followed by `knex migrate:latest` — the double-run must succeed without errors.

---

## Stage 2 — Authentication and User Management

**Goal:** Implement the auth system from §8 (JWT access tokens, single-use refresh token rotation, Google OAuth, email/password login, role-based middleware) and the user management API.

### Tasks

**2.1 — Auth service.**
Implement `auth.service.ts` with: password hashing via argon2, JWT creation (15-minute access tokens containing `user_id` and `role`), JWT verification, refresh token generation (opaque random string), refresh token hashing (SHA-256), and the single-use refresh token rotation logic from §8.2 (including the theft detection: if a used token is presented, invalidate all tokens for that user).

**2.2 — Auth routes.**
Implement `routes/auth.ts` with: `POST /api/auth/login` (email + password), `POST /api/auth/google` (Google OAuth ID token verification), `POST /api/auth/refresh` (refresh token rotation), `POST /api/auth/logout` (invalidate refresh token). The refresh token must be sent/received as an `httpOnly`, `Secure`, `SameSite=Strict` cookie.

**2.3 — Auth middleware.**
Implement `middleware/auth.ts` as a Fastify preHandler hook that extracts the JWT from the `Authorization: Bearer` header, verifies it, and attaches `user_id` and `role` to the request. Implement a `requireRole(...roles)` middleware factory that checks the attached role. Deactivated users (status = 'deactivated') must be rejected even with a valid token.

**2.4 — Admin seeding.**
Implement `scripts/seed-admin.ts` per §9.6. On backend startup, check if the `users` table is empty and `SEED_ADMIN_EMAIL` is set — if so, create the admin user. The CLI script must refuse to run if any users already exist.

**2.5 — Rate limiting on auth endpoints.**
Implement rate limiting for auth endpoints at 10 requests per minute per IP, per §5.2.

### Tests

**2.T1 — Password hashing (unit).**
Hash a password, assert the hash is not the plaintext, assert `argon2.verify` returns true for the correct password and false for an incorrect one.

**2.T2 — JWT creation and verification (unit).**
Create a token with a known `user_id` and `role`. Verify it and assert the decoded payload matches. Create an expired token (manually set `exp` in the past) and assert verification throws.

**2.T3 — Login flow (integration).**
Seed a user with a known password. Call `POST /api/auth/login` with correct credentials — assert 200, response includes an access token, and a `Set-Cookie` header contains the refresh token. Call with incorrect password — assert 401. Call with a deactivated user's credentials — assert 401 with a message indicating the account is deactivated.

**2.T4 — Refresh token rotation (integration).**
Login to get tokens. Use the refresh token to call `POST /api/auth/refresh` — assert a new access token and new refresh token are returned. Use the old refresh token again — assert 401 and confirm all refresh tokens for that user are invalidated (theft detection). Attempt to use the new refresh token after invalidation — assert 401.

**2.T5 — Auth middleware (integration).**
Create a protected route. Call it with no token — assert 401. Call with an invalid token — assert 401. Call with a valid token — assert 200. Call with a valid token but the user has been deactivated in the database — assert 401. Call a route that requires `admin` role with an `editor` token — assert 403.

**2.T6 — Admin seeding (integration).**
With an empty `users` table and `SEED_ADMIN_EMAIL` set, run the seeding logic. Assert a user is created with role `admin`. Run it again — assert it does not create a duplicate.

**2.T7 — Auth rate limiting (integration).**
Send 11 login requests in rapid succession from the same IP. Assert the 11th request receives a 429 response with a `Retry-After` header.

### Test Gate 2

Run `cd backend && npx vitest run tests/unit/auth tests/integration/auth`. All tests must pass.

---

## Stage 3 — Asset CRUD and Google Drive Service

**Goal:** Implement the Asset API (upload, read, update, soft-delete) and the Google Drive service layer. Google Drive calls are mocked in tests — no real Drive access is required at this stage.

### Tasks

**3.1 — Google Drive service.**
Implement `drive.service.ts` wrapping the `googleapis` Drive v3 client. Methods: `uploadFile(stream, metadata)` (resumable for > 5 MB), `downloadFile(driveId)` (returns a readable stream), `getFile(driveId)` (metadata only), `trashFile(driveId)`, `getChecksum(driveId)`, `getThumbnailUrl(driveId)`, `listFiles(options)` (paginated). Include the token-bucket rate limiter from §5.5 using `bottleneck`. Include the retry utility from §5.4 (exponential backoff, jitter, max 3 retries, immediate fail on 4xx except 429). Handle `storageQuotaExceeded` as a distinct non-retryable error that returns `DRIVE_STORAGE_FULL`.

**3.2 — Asset service.**
Implement `asset.service.ts` with: `createAsset(file, metadata, userId)` (uploads to Drive, inserts DB record, returns asset), `getAsset(id)`, `updateAsset(id, changes, updatedAt)` (with optimistic concurrency check on `updated_at`), `softDeleteAsset(id, userId)`, `downloadAsset(id)` (streams from Drive), `checkDuplicate(fileName, fileSize, md5)`. MIME type validation against the allowlist in §4.4 must happen here, not just in the route.

**3.3 — Asset routes.**
Implement `routes/assets.ts` per §5.2: `GET /api/assets`, `GET /api/assets/:id`, `POST /api/assets` (multipart upload), `PATCH /api/assets/:id`, `DELETE /api/assets/:id`, `GET /api/assets/:id/download`, `GET /api/assets/check-duplicate`. All routes behind auth middleware. Upload and tag changes require `editor` or `admin` role. Soft-delete requires `admin`.

**3.4 — Idempotency middleware.**
Implement `utils/idempotency.ts` per §5.4. Store idempotency keys and results in Redis with a TTL (default 24 hours). If a request arrives with a previously-seen key, return the stored result without re-executing.

**3.5 — Materialised view refresh utility.**
Implement a function `refreshSearchView()` that runs `REFRESH MATERIALIZED VIEW CONCURRENTLY asset_search_mv`. Call it after every single-asset write operation (upload, tag change, delete). The 60-second scheduled refresh is built in a later stage.

**3.6 — Audit logging.**
Implement `audit.service.ts` with a `log(userId, action, entityType, entityId, details)` method. The `details` object must conform to the schemas in §4.3. Call the audit service from every write operation in the asset service.

### Tests

**3.T1 — Drive service rate limiter (unit).**
Mock the googleapis client. Submit 15 requests in rapid succession. Assert that the rate limiter queues requests beyond the configured rate and they complete in order.

**3.T2 — Drive service retry logic (unit).**
Mock the googleapis client to return a 503 on the first call and 200 on the second. Assert the operation succeeds after one retry. Mock it to return 503 four times — assert it fails after 3 retries. Mock a 400 error — assert it fails immediately without retrying. Mock a 429 — assert it retries with backoff.

**3.T3 — Drive service storage quota error (unit).**
Mock the googleapis client to return a `storageQuotaExceeded` error. Assert the service throws a `DRIVE_STORAGE_FULL` error and does not retry.

**3.T4 — Asset creation (integration).**
Mock the Drive service. Upload an asset via `POST /api/assets` with a valid image file. Assert: the response includes the asset record with correct metadata, the `assets` table has a new row, the audit log has an `upload` entry with the correct detail schema, and `refreshSearchView` was called.

**3.T5 — MIME type validation (integration).**
Attempt to upload a file with MIME type `application/x-executable`. Assert: the request is rejected with a 400 error and a clear message. Attempt a file with `image/jpeg` but exceeding 100 MB — assert rejected.

**3.T6 — Asset update with optimistic concurrency (integration).**
Create an asset. Read its `updated_at`. Send a `PATCH` with the correct `updated_at` — assert 200. Send another `PATCH` with the old `updated_at` (which has now changed) — assert 409 Conflict.

**3.T7 — Soft delete (integration).**
Create an asset. Delete it. Assert: the asset's status is now `deleted`, the audit log has a `delete` entry, and `GET /api/assets` (default filter) no longer returns it.

**3.T8 — Duplicate detection (integration).**
Create an asset with a known file name, size, and hash. Call `GET /api/assets/check-duplicate` with matching values — assert it returns the existing asset. Call with different values — assert no match.

**3.T9 — Idempotency (integration).**
Send a `POST /api/assets` with an `Idempotency-Key` header. Assert 201. Send the same request with the same key — assert the same response is returned and no duplicate record exists.

**3.T10 — Role enforcement (integration).**
As a `viewer`, attempt `POST /api/assets` — assert 403. As a `viewer`, attempt `DELETE /api/assets/:id` — assert 403. As an `editor`, attempt `DELETE /api/assets/:id` — assert 403 (delete requires admin). As an `admin`, attempt `DELETE /api/assets/:id` — assert 200.

**3.T11 — Audit log detail schema (unit).**
For each action type in §4.3, create a `details` object and validate it against the expected schema. Assert validation passes for correct shapes and fails for missing required fields.

### Test Gate 3

Run `cd backend && npx vitest run tests/unit/drive tests/unit/audit tests/integration/assets`. All tests must pass.

---

## Stage 4 — Products, Variants, and Asset Linking

**Goal:** Implement product and variant storage, the asset-product linking API, and the tag management endpoints.

### Tasks

**4.1 — Product service.**
Implement `product.service.ts`: `upsertProduct(shopifyId, data)`, `getProduct(id)`, `listProducts(filters)`, `upsertVariant(productId, shopifyVariantId, data)`, `getVariants(productId)`.

**4.2 — Asset-product linking.**
Add to the asset service (or create a dedicated linking module): `linkAssetToProduct(assetId, productId, variantId?, role, sortOrder)`, `unlinkAsset(linkId)`, `updateLink(linkId, changes)`, `getLinksForProduct(productId)`, `getLinksForAsset(assetId)`. Enforce the partial unique index constraints — a duplicate link must return a clear 409 error.

**4.3 — Product routes.**
Implement `routes/products.ts` per §5.2: `GET /api/products`, `GET /api/products/:id`, `GET /api/products/:id/variants`, `POST /api/products/:id/assets`, `DELETE /api/products/:id/assets/:linkId`, `PATCH /api/products/:id/assets/:linkId`.

**4.4 — Tag routes.**
Implement `routes/tags.ts` per §5.2: `GET /api/tags/keys` (distinct tag keys from `assets.tags`), `GET /api/tags/values?key=x` (distinct values for a key), `GET /api/tags/facets` (counts per key/value for the current search context).

### Tests

**4.T1 — Product upsert (integration).**
Insert a product. Upsert the same product with a new title — assert the row is updated, not duplicated. Assert `shopify_id` uniqueness: inserting two products with the same `shopify_id` should update, not duplicate.

**4.T2 — Variant upsert and cascade delete (integration).**
Create a product with two variants. Delete the product. Assert both variants are cascade-deleted.

**4.T3 — Asset-product linking (integration).**
Create an asset and a product. Link them with role `hero`. Assert the link exists. Attempt to create the same link (same asset, product, null variant, same role) — assert 409. Link the same asset to the same product with role `gallery` — assert it succeeds (different role is allowed). Link the asset to the same product and role but with a specific `variant_id` — assert it succeeds (variant-level link is distinct from product-level link).

**4.T4 — Sort order update (integration).**
Create three asset-product links with sort_order 0, 1, 2. Update the middle link to sort_order 0 and the first to sort_order 1. Assert the new order is persisted.

**4.T5 — Tag key and value listing (integration).**
Create several assets with varied tags (e.g. `{"colour": "Navy", "season": "AW26"}`, `{"colour": "Red", "season": "SS27"}`). Call `GET /api/tags/keys` — assert `["colour", "season"]`. Call `GET /api/tags/values?key=colour` — assert `["Navy", "Red"]`.

**4.T6 — Product link cascading on asset delete (integration).**
Create a product, create an asset, link them. Soft-delete the asset. Assert the link still exists (soft-delete doesn't cascade). Hard-delete the asset row (simulating a future cleanup) — assert the link is cascade-deleted.

**4.T7 — Materialised view reflects links (integration).**
Create a product with title "Blue Polo Shirt" and a variant with SKU "BPS-001". Create an asset and link it to the product. Refresh the materialised view. Query the view for the asset — assert `product_titles` contains "Blue Polo Shirt" and `skus` contains "BPS-001".

### Test Gate 4

Run `cd backend && npx vitest run tests/integration/products tests/integration/tags tests/integration/links`. All tests must pass.

---

## Stage 5 — Search

**Goal:** Implement the search endpoint from §7, including free-text search, tag filtering, faceted search, sorting, and pagination. This is the most performance-critical feature.

### Tasks

**5.1 — Search service.**
Implement `search.service.ts`. Build the SQL query dynamically based on the query parameters described in §7.1: free text against `search_text` using trigram similarity, tag filters using JSONB containment, named filters (sku, type, status, category) as WHERE clauses. Implement the weighted relevance scoring from §7.1 with configurable weights loaded from `config`. Implement pagination (page + limit) and sorting (by relevance, created_at, file_name).

**5.2 — Search route.**
Implement `routes/search.ts` per §5.2: `GET /api/search` accepting all query parameters. Rate-limited to 30 requests per minute per user.

**5.3 — Faceted search.**
When `facets=true` is passed, the response includes counts per tag key/value and per asset type for the filtered result set. This is computed from the same materialised view query.

**5.4 — Scheduled materialised view refresh.**
Implement the 60-second BullMQ repeating job (`mv-refresh.job.ts`) that runs `REFRESH MATERIALIZED VIEW CONCURRENTLY`. This serves as the consistency backstop described in §7.3.

### Tests

**5.T1 — Free text search (integration).**
Seed 10 assets with varied file names, tags, and linked products. Search for a term that appears in one asset's file name — assert it is returned. Search for a product title — assert the linked asset is returned. Search for a tag value — assert the tagged asset is returned. Search for a term that matches nothing — assert an empty result set.

**5.T2 — Relevance ranking (integration).**
Create an asset with SKU "POLO-001" linked via a variant. Create another asset with file name "polo-photo.jpg". Search for "POLO-001". Assert the asset with the exact SKU match ranks higher than the file name match (because SKU weight is 10 vs file name weight 1).

**5.T3 — Tag filtering (integration).**
Create assets with tags `{"colour": "Navy"}` and `{"colour": "Red"}`. Search with `tags[colour]=Navy` — assert only the Navy asset is returned. Combine with free text: search `q=shirt&tags[colour]=Navy` — assert correct filtering.

**5.T4 — Faceted counts (integration).**
Seed 5 image assets and 3 video assets, some tagged with `colour: Navy` and some with `colour: Red`. Search with `facets=true` and no filters. Assert the facet response includes `{ asset_type: { image: 5, video: 3 }, tags: { colour: { Navy: <count>, Red: <count> } } }`. Apply a tag filter and assert the facet counts update to reflect the narrowed result set.

**5.T5 — Pagination (integration).**
Seed 60 assets. Search with `page=1&limit=25` — assert 25 results and the response includes total count of 60. Search with `page=3&limit=25` — assert 10 results.

**5.T6 — Sorting (integration).**
Seed assets with different `created_at` values. Search with `sort=created_at&order=desc` — assert results are ordered newest first. Search with `sort=file_name&order=asc` — assert alphabetical order.

**5.T7 — Search rate limiting (integration).**
Send 31 search requests in rapid succession as the same user. Assert the 31st receives 429.

**5.T8 — Materialised view consistency (integration).**
Create an asset. Without manually refreshing the view, trigger the scheduled refresh job. Query the search endpoint — assert the new asset appears. This tests the BullMQ job end-to-end.

### Test Gate 5

Run `cd backend && npx vitest run tests/integration/search`. All tests must pass.

---

## Stage 6 — Background Jobs and Bulk Operations

**Goal:** Implement BullMQ job infrastructure, bulk download, and the background job API.

### Tasks

**6.1 — BullMQ queue setup.**
Implement `jobs/queue.ts` defining the job queues and workers. Configure Redis connection, default job options (attempts, backoff), and the worker concurrency.

**6.2 — Bulk download.**
Implement `bulk-download.job.ts` per §5.2: accept an array of asset IDs (max 500), estimate total file size (reject if > 5 GB), stream files from Drive into a ZIP archive using `archiver`, save to temporary disk, update job progress via the `background_jobs` table, enforce a 2-hour timeout. Implement cleanup: a scheduled job deletes ZIP files older than 24 hours.

**6.3 — Job routes.**
Implement `routes/jobs.ts`: `GET /api/jobs/:id` (status, progress, result), `GET /api/jobs/:id/download` (stream the result file).

**6.4 — Job cleanup.**
Implement `job-cleanup.job.ts`: daily job that deletes `background_jobs` rows older than 7 days (completed) or 30 days (failed), per the retention policy in §4.5.

**6.5 — Orphan cleanup.**
Implement `orphan-cleanup.job.ts` per §5.4: hourly job that checks for Drive files with no corresponding asset record and asset records with no corresponding Drive file. Log discrepancies for admin review.

**6.6 — Audit log cleanup.**
Implement `audit-cleanup.job.ts`: daily job that deletes audit log entries older than the configured retention period (default 180 days).

### Tests

**6.T1 — Bulk download job (integration).**
Mock the Drive service to return small test files. Create 3 assets. Submit a bulk download request. Assert: a job record is created with status `pending`, the job eventually completes, the result contains a download URL, and the ZIP file at that URL contains 3 files with correct names.

**6.T2 — Bulk download limits (integration).**
Submit a bulk download with 501 asset IDs — assert 400 rejection. Mock Drive to report file sizes totalling > 5 GB — assert rejection with a clear error before the job starts.

**6.T3 — Job status API (integration).**
Create a job. Query `GET /api/jobs/:id` — assert it returns the job's status, progress, and type. After the job completes, query again — assert status is `completed` and result is populated.

**6.T4 — Job cleanup (integration).**
Create a completed job with `updated_at` set 8 days ago and a failed job with `updated_at` set 31 days ago. Run the cleanup job. Assert both are deleted. Create a completed job from 2 days ago — assert it is not deleted.

**6.T5 — Audit log cleanup (integration).**
Create audit entries with `created_at` set 181 days ago and 10 days ago. Run the cleanup job. Assert only the old entry is deleted.

**6.T6 — Orphan cleanup (integration).**
Create an asset record with a `google_drive_id` that has no corresponding file in the mock Drive. Run the orphan cleanup. Assert a log entry is created flagging the discrepancy.

### Test Gate 6

Run `cd backend && npx vitest run tests/integration/jobs tests/integration/cleanup`. All tests must pass.

---

## Stage 7 — Asset Versioning

**Goal:** Implement the transactional asset replacement flow from §4.2.

### Tasks

**7.1 — Version replace endpoint.**
Implement `POST /api/assets/:id/replace` per §5.2. The entire operation must run in a single database transaction: create a new asset record pointing to the new Drive file, move all `asset_products` links from the old asset to the new one, copy tags, increment the version, set `parent_asset_id`, archive the old asset. If any step fails, the transaction rolls back.

**7.2 — Version history endpoint.**
Implement `GET /api/assets/:id/versions` — returns all versions by following the `parent_asset_id` chain.

### Tests

**7.T1 — Successful version replace (integration).**
Create an asset with tags and product links. Replace it with a new file. Assert: a new asset record exists with `version = 2` and `parent_asset_id` pointing to the original, the original has `status = 'archived'`, all product links now reference the new asset (not the old one), tags are copied to the new asset, and the audit log has a `version` entry with the correct detail schema.

**7.T2 — Transactional rollback (integration).**
Mock the Drive upload to succeed but force the database transaction to fail (e.g. by violating a constraint). Assert: no new asset record exists, the original asset is unchanged (still active, links intact), and the Drive file from the failed attempt is cleaned up (or flagged for cleanup).

**7.T3 — Version history (integration).**
Create an asset, replace it twice (version 1 → 2 → 3). Call `GET /api/assets/:id/versions` on the latest version. Assert it returns all three versions in order with correct version numbers and parent references.

### Test Gate 7

Run `cd backend && npx vitest run tests/integration/versioning`. All tests must pass.

---

## Stage 8 — WebSocket and Real-Time Updates

**Goal:** Implement the WebSocket endpoint from §5.3 with JWT authentication, role-based message scoping, and in-band token refresh.

### Tasks

**8.1 — WebSocket handler.**
Implement `websocket/handler.ts` using Fastify's WebSocket support (e.g. `@fastify/websocket`). Validate the JWT from the `token` query parameter during the handshake — reject with 401 if invalid. After connection, associate the socket with `user_id` and `role`. Implement the message types: `job_progress` (scoped to the job's owner), `asset_change` (broadcast to all), `admin_alert` (scoped to admin role).

**8.2 — In-band token refresh.**
When the client sends `{ type: "token_refresh", token: "<new_jwt>" }`, validate the new token and update the connection's user context. If no refresh is received within 60 seconds of token expiry, close the connection with code 4001.

**8.3 — Emit events from services.**
Update the asset service, job service, and Drive watcher to emit events through the WebSocket handler when relevant actions occur (upload complete, job progress, admin alerts).

### Tests

**8.T1 — WebSocket connection with valid token (integration).**
Connect to `ws://host/api/ws?token=<valid_jwt>`. Assert the connection is established.

**8.T2 — WebSocket connection with invalid token (integration).**
Connect with an invalid token. Assert the connection is rejected (HTTP 401 before upgrade).

**8.T3 — Job progress scoping (integration).**
Connect two users (A and B) via WebSocket. Create a job owned by user A. Emit a progress event. Assert user A receives it and user B does not.

**8.T4 — Asset change broadcast (integration).**
Connect two users. Create an asset (which triggers an asset_change event). Assert both users receive the notification.

**8.T5 — Admin alert scoping (integration).**
Connect an admin and an editor. Emit an admin alert. Assert the admin receives it and the editor does not.

**8.T6 — In-band token refresh (integration).**
Connect with a token that expires in 5 seconds (for test purposes). Wait 3 seconds, send a `token_refresh` message with a new valid token. Assert the connection remains open. Connect again with a short-lived token and do not refresh — assert the connection is closed with code 4001 after expiry + 60-second grace.

### Test Gate 8

Run `cd backend && npx vitest run tests/integration/websocket`. All tests must pass.

---

## Stage 9 — Shopify Integration

**Goal:** Implement product sync, image import, asset push, webhook handling, and reconciliation per §5.6.

### Tasks

**9.1 — Shopify service.**
Implement `shopify.service.ts` using `@shopify/shopify-api`. Include the rate-aware request queue (tracking the leaky-bucket fill level from the `X-Shopify-Shop-Api-Call-Limit` header, throttling at 80% full). Methods: `fetchProducts(cursor?)` (paginated), `fetchProductImages(productId)`, `pushImage(productId, stream, metadata)`, `stagedUpload(stream, metadata)` (for large files and video), `verifyWebhook(rawBody, hmacHeader)`.

**9.2 — Product metadata sync.**
Implement `POST /api/shopify/sync-products` per §5.6: paginated product/variant fetch from Shopify, upsert into `products` and `product_variants`, record sync timestamp, refresh materialised view. This is a background job.

**9.3 — Product image import.**
Implement `POST /api/shopify/import-images` per §5.6: for each product, stream images from Shopify CDN to Google Drive, create asset records, link with role assignment (hero for position 1, gallery for others), preserve sort_order and alt text. This is a background job, separate from metadata sync.

**9.4 — Push asset to Shopify.**
Implement `POST /api/shopify/push/:assetId` per §5.6: stream from Drive to Shopify (direct piping, no buffering). Use the REST API for images under 20 MB, staged upload flow for larger files and video. Restricted to admin role.

**9.5 — Webhook handler.**
Implement `POST /api/shopify/webhooks` per §5.6: verify HMAC, handle `products/create`, `products/update`, `products/delete`. No auth middleware on this route (Shopify can't send JWTs) — HMAC verification is the authentication.

**9.6 — Reconciliation job.**
Implement `shopify-reconcile.job.ts` per §5.6: daily job comparing CMS products against a fresh Shopify catalogue pull. Create missing products, update stale products, flag orphaned CMS products.

**9.7 — Shopify status endpoint.**
Implement `GET /api/shopify/status`: last sync timestamp, webhook health, reconciliation job status.

### Tests

**9.T1 — Shopify rate limiting (unit).**
Mock the Shopify API to return a bucket fill level of 38/40. Assert the service throttles the next request. Mock a 429 response — assert retry with backoff.

**9.T2 — Product metadata sync (integration).**
Mock the Shopify API to return 3 products with variants. Run the sync job. Assert: 3 products and their variants are upserted into the database, `synced_at` is set, the materialised view is refreshed.

**9.T3 — Product metadata sync idempotency (integration).**
Run the sync twice with the same mock data. Assert: no duplicate products or variants. Run again with an updated title on one product — assert the title is updated.

**9.T4 — Image import (integration).**
Mock Shopify to return a product with 3 images (positions 1, 2, 3, one with alt text, one associated with a specific variant). Mock the Drive service. Run the import job. Assert: 3 assets are created, linked to the product with correct roles (hero, gallery, gallery), sort_order matches Shopify position, alt text is stored as a tag, the variant-associated image has the correct `variant_id` on its link.

**9.T5 — Image import duplicate skip (integration).**
Run the import with one image that already exists as an asset (matching file name). Assert: that image is skipped and logged, others are imported.

**9.T6 — Push asset to Shopify (integration).**
Create an asset linked to a product. Mock the Drive download and Shopify image creation. Call `POST /api/shopify/push/:assetId` as an admin. Assert: the Shopify API was called with the correct product ID, the returned Shopify image ID is stored on the asset record, and the audit log has a `push_shopify` entry. Attempt the same as an editor — assert 403.

**9.T7 — Webhook verification (integration).**
Send a POST to `/api/shopify/webhooks` with a valid HMAC — assert 200. Send with an invalid HMAC — assert 401. Send a `products/create` webhook — assert a new product appears in the database. Send a `products/delete` webhook — assert the product is soft-deleted.

**9.T8 — Reconciliation (integration).**
Create a product in the CMS that does not exist in mock Shopify. Create a product in mock Shopify that does not exist in the CMS. Run reconciliation. Assert: the missing CMS product is created, and the orphaned CMS product is flagged.

### Test Gate 9

Run `cd backend && npx vitest run tests/unit/shopify tests/integration/shopify`. All tests must pass.

---

## Stage 10 — Google Drive Watcher

**Goal:** Implement the Drive Changes API polling job from §5.5.

### Tasks

**10.1 — Drive watcher job.**
Implement `drive-watcher.job.ts` per §5.5. Poll every 5 minutes using `changes.list` with a stored `startPageToken`. Handle all change types: new files, modified files (thumbnail invalidation, dimension updates), renamed files, moved out of Team Drive, moved back in, permanently deleted. Persist `startPageToken` after each batch (not after the entire poll). Process changes in batches of 100 with checkpointing. After 5 consecutive failures, alert admin via WebSocket and pause.

### Tests

**10.T1 — New file detection (integration).**
Mock the Drive Changes API to report a new file. Run the watcher. Assert: a new asset record is created with `uploaded_by = NULL`, empty tags, and status `active`.

**10.T2 — File modification (integration).**
Create an asset with a cached thumbnail URL. Mock a change indicating the file's `md5Checksum` has changed. Run the watcher. Assert: the thumbnail URL is invalidated (set to null or refreshed).

**10.T3 — File rename (integration).**
Create an asset with file name "old-name.jpg". Mock a change indicating the file was renamed to "new-name.jpg". Run the watcher. Assert: the asset's `file_name` is updated, and the audit log has a `drive_rename` entry.

**10.T4 — File moved out (integration).**
Create an active asset. Mock a change indicating the file was moved out of the Team Drive. Run the watcher. Assert: the asset's status is `archived`, and the audit log has a `drive_moved_out` entry.

**10.T5 — File moved back in (integration).**
Create an archived asset (from a previous move-out). Mock a change indicating the file is back in the Team Drive. Run the watcher. Assert: the asset's status is restored to `active`.

**10.T6 — Checkpoint persistence (integration).**
Mock the Changes API to return 250 changes (more than one batch of 100). After processing the first batch, simulate a crash (stop the job). Restart the job. Assert: it resumes from the checkpointed token (change 101), not from the beginning.

**10.T7 — Failure alerting (integration).**
Mock the Changes API to fail 5 times consecutively. Assert: an admin alert is emitted via WebSocket and the job pauses.

### Test Gate 10

Run `cd backend && npx vitest run tests/integration/drive-watcher`. All tests must pass.

---

## Stage 11 — Health, Monitoring, and Error Handling

**Goal:** Implement the health endpoint, structured logging, error response formatting, and metrics.

### Tasks

**11.1 — Health endpoint.**
Implement `GET /api/health` per §5.2: check PostgreSQL connectivity, Redis connectivity, Google Drive API reachability (a lightweight `about.get` call), and Shopify API reachability. Return a JSON response with per-dependency status and an overall status. Include Drive quota check — warn when usage exceeds 90%.

**11.2 — Structured error responses.**
Implement the global error handler in `middleware/error-handler.ts` that catches all unhandled errors and formats them per §5.4: `{ error: { code, message, details } }`. Map known error types to specific codes (e.g. `ASSET_NOT_FOUND`, `CONCURRENT_MODIFICATION`, `DRIVE_STORAGE_FULL`, `RATE_LIMIT_EXCEEDED`).

**11.3 — Structured logging.**
Configure Fastify's Pino logger with JSON output. Ensure all log entries include: timestamp, level, request ID (for correlation), and relevant context (user ID, asset ID, job ID as applicable).

**11.4 — CRUD rate limiting.**
Implement the standard CRUD rate limits from §5.2 (120/min per user) and bulk operations (5/min per user). Apply to all remaining routes that don't already have specific limits.

### Tests

**11.T1 — Health endpoint (integration).**
With all services running, call `GET /api/health` — assert 200 with all dependencies healthy. Stop Redis (or mock it as unreachable) — assert the health endpoint returns a degraded status for Redis but still responds.

**11.T2 — Error response format (integration).**
Request a non-existent asset — assert the response body matches `{ error: { code: "ASSET_NOT_FOUND", message: "...", details: {} } }`. Trigger a rate limit — assert `{ error: { code: "RATE_LIMIT_EXCEEDED", ... } }`.

**11.T3 — Standard rate limiting (integration).**
Send 121 standard CRUD requests in one minute as the same user. Assert the 121st is rejected with 429. Send 6 bulk operation requests — assert the 6th is rejected.

### Test Gate 11

Run `cd backend && npx vitest run tests/integration/health tests/integration/errors tests/integration/rate-limits`. All tests must pass.

---

## Stage 12 — Frontend Core

**Goal:** Build the React frontend: asset library grid, search, asset detail panel, upload flow, and authentication.

### Tasks

**12.1 — API client with token interceptor.**
Implement `api/client.ts` per §6.2: an Axios instance with a response interceptor that, on any 401, pauses the request, calls `/api/auth/refresh`, stores the new access token in memory, retries the original request. If multiple requests fail simultaneously, only one refresh call is made. If refresh fails, redirect to login.

**12.2 — Auth pages.**
Login page (Google OAuth button + email/password form). Handle the auth flow, store the access token in memory (not localStorage), and use the refresh token cookie for persistence.

**12.3 — Asset library view.**
Implement the main view per §6.4: responsive grid of asset thumbnails, left sidebar with faceted filters (asset type, tag keys/values with counts), top bar with search input (300ms debounce), bulk action toolbar, grid/list toggle. Use TanStack Query for data fetching with the search endpoint.

**12.4 — Asset detail panel.**
Slide-over panel per §6.4: full preview (image, video, rendered markdown, sandboxed HTML iframe, PDF), editable tag chips with autocomplete, linked products list with drag-to-reorder, version history, action buttons (download, replace, push to Shopify, delete). Audit trail timeline with human-readable descriptions.

**12.5 — Upload view.**
Drag-and-drop zone per §6.4: multiple file support, pre-upload tagging, client-side file type and size validation, duplicate detection (call check-duplicate API before uploading), per-file progress bars, post-upload quick-edit.

**12.6 — Optimistic updates.**
Implement TanStack Query optimistic mutations for: tag changes (update the local cache immediately, revert on error), asset upload (append to the grid immediately), sort order changes.

**12.7 — Optimistic concurrency UI.**
When a `PATCH` returns 409, show the notification from §6.3: "This asset has been modified by another user. Please refresh and try again." with a refresh button.

### Tests

**12.T1 — Token interceptor (unit).**
Using MSW, mock the API to return 401 on a request, then 200 on the refresh call, then 200 on the retried request. Assert the original call resolves successfully. Mock the refresh to also fail — assert the user is redirected to login.

**12.T2 — Search input debounce (unit).**
Render the search component. Type "nav" rapidly. Assert that the API is called only once (after the 300ms debounce), not three times.

**12.T3 — Faceted filter rendering (unit).**
Mock the search API to return facets. Render the sidebar. Assert each facet group is displayed with correct counts. Click a facet — assert the search API is re-called with the filter applied.

**12.T4 — Upload flow validation (unit).**
Render the upload view. Drop a file with an unsupported MIME type — assert an error message is shown and the upload does not start. Drop a 200 MB image — assert a size error.

**12.T5 — Optimistic tag update (unit).**
Render the asset detail panel. Change a tag. Assert the UI reflects the change immediately (before the API responds). Mock the API to return an error — assert the change is reverted.

**12.T6 — Concurrency conflict UI (unit).**
Mock the API to return 409 on a PATCH. Edit an asset. Assert the conflict notification is displayed with a refresh button.

**12.T7 — Duplicate detection on upload (unit).**
Mock the check-duplicate API to return a match. Drop a file. Assert the duplicate modal is shown with options to skip, replace, or proceed.

### Test Gate 12

Run `cd frontend && npx vitest run`. All tests must pass.

---

## Stage 13 — Frontend: Product Browser, Shopify UI, Admin

**Goal:** Build the remaining frontend views: product browser, Shopify sync UI, admin settings, and background job dashboard.

### Tasks

**13.1 — Product browser.**
Table of products per §6.4: expand to see variants, click to see linked assets with drag-and-drop reordering. "Sync Products" and "Import Images" buttons.

**13.2 — Shopify sync UI.**
Sync status display, progress indicators for running sync/import jobs (fed by WebSocket events), last sync timestamp, webhook health indicator.

**13.3 — Admin settings.**
User management (invite, role assignment, deactivation). Google Drive connection status and Drive API quota display. Shopify connection status. Tag key management. Background job dashboard. System health overview.

**13.4 — WebSocket integration.**
Connect to the WebSocket endpoint on app load. Handle reconnection with exponential backoff. Handle in-band token refresh (send new token before the current one expires). Update job progress indicators and asset library in real time from WebSocket events.

**13.5 — Role-based UI rendering.**
Hide or disable UI elements based on the user's role per §8.3. Viewers see no upload button, no tag editing, no delete. Editors see no delete, no push-to-Shopify, no admin settings. Admins see everything.

### Tests

**13.T1 — Product browser rendering (unit).**
Mock the products API. Render the product browser. Assert products are displayed with correct columns. Expand a product — assert variants are shown.

**13.T2 — Drag-and-drop reorder (unit).**
Render the asset list for a product. Simulate a drag-and-drop reorder. Assert the `PATCH` API is called with the new sort order.

**13.T3 — WebSocket reconnection (unit).**
Mock a WebSocket that disconnects after 1 second. Assert the client reconnects with exponential backoff (first retry after ~1 second, second after ~2 seconds).

**13.T4 — Role-based rendering (unit).**
Render the asset library as a `viewer`. Assert the upload button is not present, the delete button is not present, and the tag edit controls are disabled. Render as an `editor` — assert upload is present but delete is not. Render as an `admin` — assert all controls are present.

**13.T5 — Job progress display (unit).**
Render the job dashboard. Simulate a WebSocket `job_progress` event. Assert the progress bar updates in real time.

### Test Gate 13

Run `cd frontend && npx vitest run`. All tests must pass.

---

## Stage 14 — Docker, Infrastructure, and Integration

**Goal:** Build the Docker images, verify the full Compose stack runs end-to-end, and validate the infrastructure configuration.

### Tasks

**14.1 — Backend Dockerfile.**
Multi-stage build: install dependencies, compile TypeScript, produce a minimal production image. Include a non-root user.

**14.2 — Frontend Dockerfile.**
Multi-stage build: install dependencies, run `vite build`, serve the static output via Nginx (or a lightweight static server) on port 80.

**14.3 — Caddyfile.**
Implement exactly as specified in §9.1. The WebSocket route, API route, and frontend fallback. Security headers. The preview subdomain with restrictive CSP.

**14.4 — docker-compose.yml validation.**
Verify the full stack as defined in §9.1 starts cleanly: Caddy, app, worker, frontend, db, redis.

**14.5 — Admin seed on first boot.**
Set `SEED_ADMIN_EMAIL` in `.env`. Start the stack for the first time. Verify the admin user is created.

### Tests

**14.T1 — Docker build (integration).**
Run `docker compose build`. Assert all images build without errors.

**14.T2 — Stack startup (integration).**
Run `docker compose up -d`. Wait for all health checks to pass (poll `docker compose ps` until all services are healthy). Assert all 6 services are running.

**14.T3 — Health endpoint through Caddy (integration).**
With the stack running, call `https://localhost/api/health` (or the configured domain). Assert 200 with all dependencies healthy.

**14.T4 — Frontend served through Caddy (integration).**
With the stack running, call `https://localhost/` — assert an HTML response containing the React app's root element.

**14.T5 — WebSocket through Caddy (integration).**
With the stack running, open a WebSocket connection to `wss://localhost/api/ws?token=<valid_jwt>`. Assert the connection is established and a test message can be sent/received.

**14.T6 — Database migrations on startup (integration).**
Start the stack from scratch (no existing data). Assert the database schema is fully created (migrations run automatically on backend startup).

### Test Gate 14

All Docker and infrastructure tests must pass. Run `docker compose down -v` (clean volumes) and `docker compose up -d` from scratch — the stack must reach a healthy state within 60 seconds with the admin user seeded.

---

## Stage 15 — End-to-End Smoke Tests

**Goal:** Run a suite of end-to-end tests that exercise the full system through the API (backend + database + Redis, with mocked external services) to verify that the major user workflows work from start to finish.

### Tasks

**15.1 — Write the E2E test suite.**
These tests run against the full backend (not individual services) with a real PostgreSQL and Redis instance (from `docker-compose.test.yml`). Google Drive and Shopify are mocked at the service layer.

### Tests

**15.T1 — Full upload-to-search workflow.**
As an admin: login, upload an image asset, add tags, link to a product. Search for the asset by tag value — assert it is found. Search by product title — assert it is found. Search by file name — assert it is found.

**15.T2 — Full Shopify sync workflow.**
Trigger a product metadata sync. Assert products and variants appear in the database. Link an asset to a synced product. Push the asset to Shopify — assert the mock Shopify API receives the correct call.

**15.T3 — Version replace workflow.**
Upload an asset, link it to a product, add tags. Replace the asset with a new file. Assert: the new version has the tags and product links, the old version is archived, searching for the product returns the new version.

**15.T4 — Bulk download workflow.**
Upload 5 assets. Request a bulk download of all 5. Poll the job status until complete. Download the ZIP. Assert it contains 5 files.

**15.T5 — Concurrent edit conflict.**
As user A: load an asset. As user B: update the same asset's tags. As user A: attempt to update the asset with the stale `updated_at` — assert 409.

**15.T6 — User deactivation workflow.**
As admin: create an editor user. As the editor: login successfully. As admin: deactivate the editor. As the editor: attempt to login — assert 401. As the editor: attempt to use an existing access token — assert 401 (middleware checks user status).

**15.T7 — Webhook processing workflow.**
Send a valid Shopify `products/create` webhook. Assert the product appears in the database. Send a `products/update` webhook — assert the product is updated. Send a `products/delete` webhook — assert the product is soft-deleted.

**15.T8 — Drive watcher new file workflow.**
Mock the Drive Changes API to report a new file. Run the watcher job. Assert the file appears as an untagged asset. Search for it by file name — assert it is found.

### Test Gate 15

Run `cd backend && npx vitest run tests/e2e`. All tests must pass. This is the final quality gate before the system is considered ready for deployment.

---

## Summary of Test Gates

| Gate | Stage | What It Validates | Must Pass Before |
|------|-------|-------------------|------------------|
| 0 | Scaffolding | Project builds, test runners work, Docker services start | Stage 1 |
| 1 | Schema | All tables, columns, constraints, indexes, materialised view | Stage 2 |
| 2 | Auth | Login, refresh rotation, theft detection, role middleware, seeding | Stage 3 |
| 3 | Assets | Upload, CRUD, Drive service, MIME validation, idempotency, audit | Stage 4 |
| 4 | Products | Product/variant CRUD, asset linking, partial unique indexes, tags | Stage 5 |
| 5 | Search | Free text, relevance ranking, tag filters, facets, pagination | Stage 6 |
| 6 | Jobs | Bulk download, job lifecycle, cleanup jobs | Stage 7 |
| 7 | Versioning | Transactional replace, rollback, version history | Stage 8 |
| 8 | WebSocket | Auth, scoping, token refresh, reconnection | Stage 9 |
| 9 | Shopify | Sync, import, push, webhooks, reconciliation | Stage 10 |
| 10 | Drive Watcher | All change types, checkpointing, failure alerting | Stage 11 |
| 11 | Health | Health endpoint, error format, rate limits | Stage 12 |
| 12 | Frontend Core | Library, search, upload, auth, optimistic updates | Stage 13 |
| 13 | Frontend Rest | Products, Shopify UI, admin, WebSocket, role-based rendering | Stage 14 |
| 14 | Infrastructure | Docker builds, Compose stack, Caddy routing, migrations | Stage 15 |
| 15 | E2E | Full user workflows through the API | Deployment |

---

## Instructions for Claude Code

When executing this plan, follow these rules:

1. **Read the architecture document** (cms-architecture-v3.md) before starting each stage. The section references (e.g. §4.5, §5.2) point to the exact specifications.

2. **Write tests alongside implementation code**, not after. For each task, write the corresponding tests from the test list before or concurrently with the feature code.

3. **Run the test gate at the end of every stage.** If any test fails, diagnose and fix the issue. Re-run the full gate until all tests pass. Do not proceed to the next stage with failing tests.

4. **Use the test database** (`docker-compose.test.yml`) for all integration tests. Each test should run in a transaction that rolls back after completion to avoid test pollution.

5. **Mock external services** (Google Drive, Shopify) in tests using the mocks in `tests/helpers/mocks.ts`. These mocks should simulate realistic API behaviour including rate limit headers and error responses.

6. **Commit after each passing test gate.** Each stage represents a logical, tested increment of the system.

7. **If a stage requires changes to code from a previous stage**, run the previous stage's test gate again after making the changes to ensure nothing is broken.
