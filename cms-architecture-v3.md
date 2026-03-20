# Digital Asset CMS — Architecture & Design Document

**Version:** 3.0
**Date:** 9 March 2026
**Status:** Draft — For Review

---

## 1. Executive Summary

This document describes the architecture of a self-hosted Content Management System (CMS) designed for managing digital assets — primarily images, videos, and text content — tied to product data. The system uses Google Team Drive as its file storage backend, supports rich product-level tagging and search, and integrates with Shopify for product synchronisation and asset publishing.

The system is designed for a small team of 2–10 users with role-based access, and is built on a Node.js backend with a React frontend.

This is version 3.0 of the architecture document, revised to address gaps identified in the v2 review around materialised view consistency, WebSocket security, data model constraints, versioning atomicity, operational guardrails, and several smaller issues related to security, bootstrapping, and cleanup policies.

---

## 2. Goals & Requirements

### 2.1 Core Goals

- Provide a single, searchable interface for all digital product assets.
- Use an existing Google Team Drive as the canonical file store (no migration of files required).
- Allow tagging assets with structured product metadata (SKU, category, product name, etc.).
- Enable fast search and filtering by any combination of tags.
- Support downloading individual assets or batches.
- Synchronise product data with a Shopify store bidirectionally.

### 2.2 Functional Requirements

| ID    | Requirement                                                                 |
|-------|-----------------------------------------------------------------------------|
| FR-01 | Upload assets (images, videos, text files) via the UI; files stored on Google Drive. |
| FR-02 | Tag any asset with one or more: SKU, product name, product category, custom metadata key-value pairs. |
| FR-03 | Full-text and faceted search across all tag fields and file names.          |
| FR-04 | Preview images and videos inline; preview text content (plain text, Markdown, HTML). |
| FR-05 | Download single assets or bulk-download a filtered set as a ZIP archive (generated as a background job for large selections). |
| FR-06 | Import product catalogue from Shopify (name, SKUs, category, variants) as a metadata-only sync, with an optional separate step to import existing Shopify product images. |
| FR-07 | Push selected assets to Shopify as product images or media.                 |
| FR-08 | Role-based access: Admin, Editor, Viewer.                                   |
| FR-09 | Audit log of uploads, tag changes, downloads, and Shopify syncs with structured detail payloads. |
| FR-10 | Webhook-driven sync so Shopify product changes are reflected automatically, backed by a periodic reconciliation job. |
| FR-11 | Duplicate detection on upload based on file name, size, and Drive file hash. |
| FR-12 | Basic asset versioning — allow replacing an asset's file while preserving the asset record and its tags/product links. |
| FR-13 | Defined set of supported file formats with size limits per type.            |

### 2.3 Non-Functional Requirements

| ID     | Requirement                                                                |
|--------|----------------------------------------------------------------------------|
| NFR-01 | Page loads and search results return in under 2 seconds for up to 50,000 assets. |
| NFR-02 | System runs on a single server as a Docker Compose stack with all services defined (including reverse proxy). |
| NFR-03 | No vendor lock-in beyond Google Drive and Shopify (both via standard APIs).|
| NFR-04 | Database backups run on a frequent schedule with support for point-in-time recovery via WAL archiving. File backups are handled by Google Drive's own versioning. |
| NFR-05 | All services include health checks and restart policies. Basic monitoring and log aggregation are in place from launch. |
| NFR-06 | All external API calls (Google Drive, Shopify) include rate limiting, exponential backoff, and idempotency handling. |

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                             │
│                  React SPA (Vite build)                      │
│   ┌───────────┐ ┌──────────┐ ┌────────────┐ ┌───────────┐  │
│   │  Asset    │ │  Search  │ │  Product   │ │  Shopify  │  │
│   │  Library  │ │  & Filter│ │  Tagger    │ │  Sync UI  │  │
│   └───────────┘ └──────────┘ └────────────┘ └───────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS / REST + WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│                    REVERSE PROXY                             │
│                  Caddy (auto HTTPS)                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                       BACKEND                                │
│                 Node.js (Fastify)                             │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐    │
│  │ Asset API  │  │ Search API │  │ Shopify Integration  │    │
│  │ (CRUD,     │  │ (query     │  │ (product sync,       │    │
│  │  tagging,  │  │  builder,  │  │  media push,         │    │
│  │  download) │  │  facets)   │  │  webhook handler)    │    │
│  └─────┬──────┘  └─────┬──────┘  └──────────┬──────────┘    │
│        │               │                     │               │
│  ┌─────▼───────────────▼─────────────────────▼──────────┐    │
│  │              Service Layer                            │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │    │
│  │  │ Google Drive  │  │  Database    │  │  Shopify   │  │    │
│  │  │ Service       │  │  Service     │  │  Service   │  │    │
│  │  │ (rate-limited)│  │              │  │(rate-aware)│  │    │
│  │  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘  │    │
│  └─────────┼─────────────────┼────────────────┼──────────┘    │
└────────────┼─────────────────┼────────────────┼──────────────┘
             │                 │                │
     ┌───────▼───────┐  ┌─────▼──────┐  ┌──────▼──────┐
     │ Google Drive   │  │ PostgreSQL │  │  Shopify    │
     │ (Team Drive)   │  │ + pg_trgm  │  │  Admin API  │
     │                │  │ + pgvector │  │  + Webhooks │
     └────────────────┘  └────────────┘  └─────────────┘
```

### 3.1 Component Summary

- **Frontend (React SPA):** The user interface. Handles browsing, previewing, tagging, searching, and managing Shopify sync. Communicates with the backend exclusively via REST endpoints and a WebSocket channel for real-time progress updates (e.g. bulk upload progress, sync status, background job completion). Includes a transparent token refresh interceptor for seamless authentication.

- **Reverse Proxy (Caddy):** Sits in front of the backend and frontend, handling TLS termination via automatic Let's Encrypt certificates, CORS enforcement, and routing. Defined as part of the Docker Compose stack.

- **Backend (Node.js):** The API server. Orchestrates all business logic, enforces access control, and mediates between the three external systems (Google Drive, PostgreSQL, Shopify). Stateless by design — all persistent state lives in the database or Google Drive. Includes structured error handling and idempotency for all write operations.

- **PostgreSQL:** Stores all metadata: asset records (with tags stored as JSONB), product and variant data, user accounts, audit logs. The `pg_trgm` extension powers fast fuzzy text search via a materialised search view. An optional `pgvector` extension can support future semantic search. WAL archiving is enabled for point-in-time recovery.

- **Google Team Drive:** The file store. The CMS never duplicates files locally — it reads, writes, and streams files directly via the Google Drive API v3. The Drive service layer includes built-in rate limiting and exponential backoff to stay within API quotas.

- **Shopify Admin API:** Used to pull product catalogues (metadata and optionally images) into the CMS and to push assets (images/video) back to product listings. The Shopify service layer uses rate-aware request queuing to respect the leaky-bucket rate limit.

---

## 4. Data Model

### 4.1 Entity-Relationship Overview

```
┌─────────────┐       ┌──────────────────┐       ┌──────────────┐
│    users     │       │     assets       │       │   products   │
├─────────────┤       ├──────────────────┤       ├──────────────┤
│ id (PK)     │       │ id (PK)          │       │ id (PK)      │
│ email       │       │ file_name        │       │ shopify_id   │
│ name        │       │ asset_type       │       │ title        │
│ role        │       │ mime_type        │       │ category     │
│ status      │       │ file_size_bytes  │       │ vendor       │
│ avatar_url  │       │ google_drive_id  │       │ status       │
│ created_at  │       │ google_drive_url │       │ shopify_tags │
│ updated_at  │       │ thumbnail_url    │       │ synced_at    │
└─────────────┘       │ thumb_expires_at │       │ created_at   │
                      │ thumb_expires_at │       │ created_at   │
                      │ width            │       │ updated_at   │
                      │ height           │       └──────┬───────┘
                      │ duration_seconds │              │
                      │ status           │    ┌─────────▼────────┐
                      │ tags (jsonb)     │    │ product_variants  │
                      │ version          │    ├──────────────────┤
                      │ parent_asset_id  │    │ id (PK)          │
                      │ uploaded_by (FK) │    │ product_id (FK)  │
                      │ updated_at       │    │ shopify_variant_id│
                      │ created_at       │    │ sku              │
                      └────────┬─────────┘    │ title            │
                               │              │ price            │
                               │              │ created_at       │
                               │              │ updated_at       │
                               │              └────────┬─────────┘
                               │                       │
                      ┌────────▼───────────────────────▼────────┐
                      │          asset_products                  │
                      ├─────────────────────────────────────────┤
                      │ id (PK, surrogate)                       │
                      │ asset_id (FK)                            │
                      │ product_id (FK)                          │
                      │ variant_id (FK, nullable)                │
                      │ role (e.g. "hero", "gallery", "swatch") │
                      │ sort_order                               │
                      │ UNIQUE (asset_id, product_id,            │
                      │         variant_id, role) — see §4.2     │
                      └─────────────────────────────────────────┘

                      ┌──────────────────┐
                      │   audit_log      │
                      ├──────────────────┤
                      │ id (PK)          │
                      │ user_id (FK)     │
                      │ action           │  ← "upload", "tag_change", "download",
                      │ entity_type      │     "sync", "push_shopify", "delete"
                      │ entity_id        │
                      │ details (jsonb)  │  ← structured per action type (see §4.3)
                      │ created_at       │
                      └──────────────────┘

                      ┌────────────────────┐
                      │  asset_search_mv   │  ← materialised view
                      ├────────────────────┤
                      │ asset_id           │
                      │ search_text        │  ← concatenated searchable fields
                      │ tag_text           │  ← concatenated tag values only
                      │ search_vector      │  ← tsvector for full-text
                      │ file_name          │
                      │ product_title      │
                      │ sku                │
                      │ tag_values         │
                      │ asset_type         │
                      │ status             │
                      │ created_at         │
                      └────────────────────┘
```

### 4.2 Key Design Decisions

- **Tags stored as JSONB on the `assets` table** rather than in a separate key-value join table. This allows arbitrary metadata (e.g. `{"colour": "Navy", "season": "AW26", "shoot_location": "Studio B"}`) while enabling efficient multi-key filtering via PostgreSQL's GIN-indexed JSONB operators (`@>`, `?`, `?&`). A separate `asset_tags` index table is unnecessary — JSONB with a GIN index handles both filtering and facet counting natively. Users can tag an asset with any key-value pair without schema changes.

- **`product_variants` table** to correctly model Shopify's product/variant hierarchy. A Shopify product can have multiple variants, each with its own SKU, title, and price. The CMS stores these as first-class entities so that SKU-based search works at the variant level. The `asset_products` join table includes an optional `variant_id` foreign key so assets can be linked to a specific variant (e.g. a colour swatch for a particular variant) or to the product as a whole (when `variant_id` is null).

- **`asset_products` with a surrogate primary key** and a compound unique constraint on `(asset_id, product_id, variant_id, role)`. This allows a single asset to serve multiple roles for the same product (e.g. both "hero" and "gallery") and to be linked to different variants in the same role (e.g. a colour swatch for variant A and variant B). Because PostgreSQL's `UNIQUE` constraints treat NULLs as distinct (meaning `variant_id = NULL` would not be deduplicated), this is implemented as two partial unique indexes: one for rows where `variant_id IS NOT NULL` covering all four columns, and one for rows where `variant_id IS NULL` covering `(asset_id, product_id, role)` only. This ensures that a product-level link (no variant) is still unique per role, while variant-level links are unique per variant per role.

- **`status` column on `assets`** with values `active`, `archived`, `deleted`. Soft-deletion sets status to `deleted` rather than removing the row. All default queries filter to `status = 'active'`. Archived assets are hidden from the default library view but remain searchable via an explicit filter.

- **Basic asset versioning** via `version` (integer, starting at 1) and `parent_asset_id` (self-referential FK). When a user replaces an asset's file, the entire operation is wrapped in a single database transaction: the system creates a new asset record pointing to the new Google Drive file, *moves* all existing `asset_products` links from the old asset to the new one (updating `asset_id` in place, preserving `variant_id`, `role`, and `sort_order`), copies the tags, increments the version, sets `parent_asset_id` to the original asset, and sets the original to `status = 'archived'`. If any step fails, the transaction rolls back and no changes are persisted. Product links are moved rather than copied because the old asset is being archived — keeping links on both records would create ambiguity about which asset is canonical. This preserves full history while keeping the active library clean.

- **Google Drive ID as the canonical file reference:** The CMS stores `google_drive_id` and constructs streaming URLs on the fly. Files are never copied to local disk. The Google Drive remains the single source of truth for file content.

- **Materialised search view (`asset_search_mv`)** built from day one, flattening asset metadata, tags, product titles, and variant SKUs into a single searchable row per asset. This avoids expensive multi-table joins on every search query. The view is refreshed on a 60-second schedule as a background consistency backstop. For single-asset write operations (upload, tag change, product link), the view is refreshed on-demand immediately after the operation completes — this is fast for small datasets (under ~100,000 assets) when using `REFRESH MATERIALIZED VIEW CONCURRENTLY`. Additionally, the frontend uses TanStack Query's optimistic updates to append or update the just-modified asset in the local search cache immediately, so the user sees their change reflected in the UI without waiting for either the view refresh or a re-fetch. The 60-second scheduled refresh ensures all clients converge to a consistent state.

- **Structured audit log details.** The `details` JSONB column follows a defined schema per action type (see section 4.3) so the frontend can render human-readable change descriptions rather than raw JSON. The audit log has a configurable retention policy (default: 180 days). A periodic background job (`AuditLogCleanupJob`, runs daily) deletes entries older than the retention threshold. Completed entries older than the retention period serve no operational purpose and would otherwise accumulate into millions of rows.

### 4.3 Audit Log Detail Schemas

Each audit action type has a defined `details` payload structure:

| Action          | Details Schema                                                                 |
|-----------------|--------------------------------------------------------------------------------|
| `upload`        | `{ file_name, mime_type, file_size_bytes, google_drive_id }`                   |
| `tag_change`    | `{ changes: [{ key, old_value, new_value }] }` — `old_value` is null for additions, `new_value` is null for removals. |
| `download`      | `{ file_name, source: "single" | "bulk" }`                                    |
| `bulk_download` | `{ asset_count, total_size_bytes, job_id }`                                    |
| `link_product`  | `{ product_id, variant_id, role, sort_order }`                                 |
| `unlink_product`| `{ product_id, variant_id, role }`                                             |
| `push_shopify`  | `{ product_id, shopify_product_id, shopify_image_id, status: "success" | "failed", error? }` |
| `sync`          | `{ direction: "import" | "push", products_affected, duration_ms }`             |
| `delete`        | `{ file_name, previous_status, google_drive_id }`                              |
| `version`       | `{ previous_version, new_version, previous_drive_id, new_drive_id }`           |
| `role_change`   | `{ target_user_id, old_role, new_role }`                                       |
| `user_deactivate` | `{ target_user_id, email, previous_role }`                                   |
| `drive_rename`  | `{ google_drive_id, old_file_name, new_file_name }`                            |
| `drive_moved_out` | `{ google_drive_id, file_name, previous_status }`                            |

### 4.4 Supported File Types

The CMS enforces an allowlist of accepted file types, validated server-side by MIME type (not file extension alone):

| Category | Accepted MIME Types                                                        | Max Size  |
|----------|---------------------------------------------------------------------------|-----------|
| Image    | `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/svg+xml`, `image/tiff` | 100 MB    |
| Video    | `video/mp4`, `video/quicktime`, `video/webm`, `video/x-msvideo`           | 1 GB      |
| Text     | `text/plain`, `text/markdown`, `text/html`, `text/csv`                     | 10 MB     |
| Document | `application/pdf`                                                          | 50 MB     |

Files exceeding these limits or with unrecognised MIME types are rejected with a clear error message. The limits are configurable via environment variables.

Text content is view-only within the CMS. Plain text and Markdown are rendered inline; HTML is rendered in a sandboxed iframe. The CMS does not provide a text editor — users upload text files the same way they upload images.

### 4.5 SQL Schema

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE user_role AS ENUM ('admin', 'editor', 'viewer');
CREATE TYPE asset_type AS ENUM ('image', 'video', 'text', 'document', 'other');
CREATE TYPE asset_status AS ENUM ('active', 'archived', 'deleted');

-- ── Users ──

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    role          user_role NOT NULL DEFAULT 'viewer',
    status        TEXT NOT NULL DEFAULT 'active',  -- 'active' or 'deactivated'
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ── Products & Variants ──

CREATE TABLE products (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shopify_id    BIGINT UNIQUE,
    title         TEXT NOT NULL,
    category      TEXT,
    vendor        TEXT,
    status        TEXT DEFAULT 'active',
    shopify_tags  TEXT[] DEFAULT '{}',
    synced_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE product_variants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id          UUID REFERENCES products(id) ON DELETE CASCADE,
    shopify_variant_id  BIGINT UNIQUE,
    sku                 TEXT,
    title               TEXT,
    price               NUMERIC(10, 2),
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ── Assets ──

CREATE TABLE assets (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name         TEXT NOT NULL,
    asset_type        asset_type NOT NULL DEFAULT 'other',
    mime_type         TEXT NOT NULL,
    file_size_bytes   BIGINT,
    google_drive_id   TEXT UNIQUE NOT NULL,
    google_drive_url  TEXT,
    thumbnail_url     TEXT,
    thumb_expires_at  TIMESTAMPTZ,
    width             INT,
    height            INT,
    duration_seconds  REAL,
    status            asset_status NOT NULL DEFAULT 'active',
    tags              JSONB DEFAULT '{}',
    version           INT NOT NULL DEFAULT 1,
    parent_asset_id   UUID REFERENCES assets(id),
    uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ── Asset–Product Links ──

CREATE TABLE asset_products (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id    UUID REFERENCES assets(id) ON DELETE CASCADE,
    product_id  UUID REFERENCES products(id) ON DELETE CASCADE,
    variant_id  UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    role        TEXT DEFAULT 'gallery',
    sort_order  INT DEFAULT 0
    -- Uniqueness enforced via partial indexes below (see Indexes section)
);

-- ── Audit Log ──

CREATE TABLE audit_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    action       TEXT NOT NULL,
    entity_type  TEXT,
    entity_id    UUID,
    details      JSONB DEFAULT '{}',
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- ── Refresh Tokens (for single-use rotation) ──

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT UNIQUE NOT NULL,
    used        BOOLEAN DEFAULT FALSE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Background Job Tracking ──
-- Retention: completed jobs deleted after 7 days, failed jobs after 30 days (configurable).
-- Cleanup runs as a daily BullMQ repeating job (JobCleanupJob).

CREATE TABLE background_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type        TEXT NOT NULL,              -- "bulk_download", "shopify_sync", etc.
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed
    user_id     UUID REFERENCES users(id),
    progress    INT DEFAULT 0,             -- percentage 0–100
    result      JSONB DEFAULT '{}',        -- e.g. { download_url: "..." }
    error       TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ──

CREATE INDEX idx_assets_status ON assets (status);
CREATE INDEX idx_assets_tags ON assets USING gin (tags);
CREATE INDEX idx_assets_file_name_trgm ON assets USING gin (file_name gin_trgm_ops);
CREATE INDEX idx_assets_parent ON assets (parent_asset_id) WHERE parent_asset_id IS NOT NULL;
CREATE INDEX idx_products_title_trgm ON products USING gin (title gin_trgm_ops);
CREATE INDEX idx_product_variants_sku ON product_variants (sku);
CREATE INDEX idx_product_variants_product ON product_variants (product_id);
CREATE INDEX idx_asset_products_asset ON asset_products (asset_id);
CREATE INDEX idx_asset_products_product ON asset_products (product_id);
-- Partial unique indexes for asset_products (handles nullable variant_id correctly)
CREATE UNIQUE INDEX idx_ap_unique_with_variant
    ON asset_products (asset_id, product_id, variant_id, role)
    WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX idx_ap_unique_without_variant
    ON asset_products (asset_id, product_id, role)
    WHERE variant_id IS NULL;
CREATE INDEX idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);

-- ── Materialised Search View ──

CREATE MATERIALIZED VIEW asset_search_mv AS
SELECT
    a.id AS asset_id,
    a.file_name,
    a.asset_type,
    a.status,
    a.tags,
    a.created_at,
    a.updated_at,
    array_agg(DISTINCT p.title) FILTER (WHERE p.title IS NOT NULL) AS product_titles,
    array_agg(DISTINCT pv.sku) FILTER (WHERE pv.sku IS NOT NULL) AS skus,
    (SELECT string_agg(value, ' ') FROM jsonb_each_text(a.tags)) AS tag_text,
    concat_ws(' ',
        a.file_name,
        array_to_string(array_agg(DISTINCT p.title) FILTER (WHERE p.title IS NOT NULL), ' '),
        array_to_string(array_agg(DISTINCT pv.sku) FILTER (WHERE pv.sku IS NOT NULL), ' '),
        (SELECT string_agg(value, ' ') FROM jsonb_each_text(a.tags))
    ) AS search_text
FROM assets a
LEFT JOIN asset_products ap ON a.id = ap.asset_id
LEFT JOIN products p ON ap.product_id = p.id
LEFT JOIN product_variants pv ON ap.variant_id = pv.id
WHERE a.status = 'active'
GROUP BY a.id;

CREATE INDEX idx_search_mv_text_trgm ON asset_search_mv USING gin (search_text gin_trgm_ops);
CREATE INDEX idx_search_mv_tag_text_trgm ON asset_search_mv USING gin (tag_text gin_trgm_ops);
CREATE INDEX idx_search_mv_asset_type ON asset_search_mv (asset_type);
CREATE INDEX idx_search_mv_tags ON asset_search_mv USING gin (tags);
CREATE UNIQUE INDEX idx_search_mv_asset_id ON asset_search_mv (asset_id);
```

---

## 5. Backend Architecture

### 5.1 Technology Choices

| Component          | Choice                  | Rationale                                                                  |
|--------------------|-------------------------|----------------------------------------------------------------------------|
| Runtime            | Node.js 20 LTS         | Excellent async I/O for streaming files; rich ecosystem for Google and Shopify SDKs. |
| Framework          | Fastify                 | Faster than Express with built-in schema validation and plugin architecture. |
| Database driver    | `pg` + Knex.js          | Knex provides a clean query builder and migration system without the overhead of a full ORM. |
| Google Drive SDK   | `googleapis` (official) | The `drive.files.*` methods cover all needed operations.                   |
| Shopify SDK        | `@shopify/shopify-api`  | Official library with built-in auth, REST and GraphQL support, and webhook verification. |
| Auth               | JWT (access + refresh)  | Stateless, works well with a small team. Tokens issued after Google OAuth or email/password login. Single-use refresh token rotation for security. |
| Job queue          | BullMQ + Redis          | Handles background work: bulk uploads, bulk downloads, Shopify sync, thumbnail refresh, search view refresh. |
| File streaming     | Node.js Streams         | Pipes files directly from Google Drive to the client (or to Shopify) with no local buffering for standard operations. |

### 5.2 API Design

The backend exposes a RESTful API. All endpoints require a valid JWT in the `Authorization: Bearer <token>` header except the auth routes and the Shopify webhook receiver.

CORS is configured on the backend (and enforced at the Caddy reverse proxy) to allow only the specific frontend origin. No wildcard origins are permitted in production.

#### Assets

```
GET    /api/assets              — List/search assets (query params for filters)
GET    /api/assets/:id          — Get single asset with tags and product links
POST   /api/assets              — Upload new asset (multipart; file goes to Drive)
PATCH  /api/assets/:id          — Update asset metadata or tags
DELETE /api/assets/:id          — Soft-delete asset (sets status to 'deleted'; optionally trashes on Drive)
POST   /api/assets/:id/replace  — Upload a replacement file (creates new version)
GET    /api/assets/:id/versions — List all versions of an asset
GET    /api/assets/:id/download — Stream file from Google Drive to client
POST   /api/assets/bulk-download — Accepts array of asset IDs; creates a background job; returns job ID.
                                    Maximum 500 assets per request. Server estimates total file size before
                                    starting; requests exceeding 5 GB estimated total are rejected. The
                                    background job has a 2-hour timeout. Generated ZIP files are written to
                                    temporary disk storage and automatically deleted after 24 hours.
GET    /api/assets/check-duplicate — Check for existing assets by file name + size + hash
```

#### Tags

```
GET    /api/tags/keys           — List all distinct tag keys (for autocomplete)
GET    /api/tags/values?key=x   — List all distinct values for a given key
GET    /api/tags/facets         — Return tag key/value counts for the current search context
```

Tags are managed directly on the asset via `PATCH /api/assets/:id` (updating the JSONB `tags` field), rather than through a separate tags sub-resource. This simplifies the API and ensures tag changes are atomic with other metadata updates.

#### Products

```
GET    /api/products            — List products (with search, includes variant count)
GET    /api/products/:id        — Get product with variants and linked assets
GET    /api/products/:id/variants — List variants for a product
POST   /api/products/:id/assets — Link assets to a product (body includes role, variant_id, sort_order)
DELETE /api/products/:id/assets/:linkId — Unlink an asset (by asset_products.id)
PATCH  /api/products/:id/assets/:linkId — Update link role or sort_order
```

#### Shopify

```
POST   /api/shopify/sync-products  — Trigger a product metadata import from Shopify (no images)
POST   /api/shopify/import-images  — Trigger import of Shopify product images to Google Drive (separate, optional)
POST   /api/shopify/push/:assetId  — Push an asset to its linked Shopify product as media (Admin approval required)
POST   /api/shopify/webhooks       — Webhook receiver (product create/update/delete)
GET    /api/shopify/status         — Current sync status, last sync timestamp, webhook health
POST   /api/shopify/reconcile      — Trigger a reconciliation job comparing CMS products against Shopify
```

#### Search

```
GET /api/search?q=<term>&sku=<sku>&category=<cat>&tags[colour]=Navy&type=image&page=1&limit=50
```

The search endpoint supports:
- `q` — free text, matched against the `search_text` column in the materialised view using trigram similarity.
- Named filters — `sku`, `category`, `type`, `product_id`, `status` for exact or prefix matches.
- Tag filters — `tags[key]=value` syntax for filtering on any custom tag via JSONB operators.
- Sorting — `sort=created_at|file_name|relevance`, `order=asc|desc`.
- Pagination — `page` and `limit`.
- Facets — when `facets=true` is passed, the response includes counts per tag key/value and per asset type for the current filter context.

#### Background Jobs

```
GET    /api/jobs/:id            — Get job status, progress, and result
GET    /api/jobs/:id/download   — Download the result file (e.g. ZIP) for a completed job
```

#### Audit Log (Admin only)

```
GET    /api/audit-log           — List audit entries (query params: entity_type, entity_id, action,
                                  user_id, from, to, page, limit). Ordered by created_at DESC.
```

#### Health

```
GET    /api/health              — Returns service health (checks DB, Redis, Google Drive, Shopify API connectivity)
```

#### Rate Limiting

All API endpoints include rate limiting in addition to the external API rate limiting described elsewhere:

- **Auth endpoints** (login, token refresh): 10 requests per minute per IP.
- **Search endpoint** (`GET /api/search`): 30 requests per minute per authenticated user. Search queries use trigram similarity against the materialised view, which is more expensive than standard lookups. The frontend should debounce the search input (300ms recommended) as a complement to server-side limits.
- **Bulk operations** (bulk download, bulk tag): 5 requests per minute per user.
- **Standard CRUD endpoints**: 120 requests per minute per user.

Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are included in all responses. When a limit is exceeded, the API returns `429 Too Many Requests` with a `Retry-After` header.

### 5.3 WebSocket Authentication & Scoping

The backend exposes a WebSocket endpoint at `/api/ws` for real-time progress updates (bulk upload progress, sync status, background job completion, admin alerts).

**Authentication:** The client connects with the access token as a query parameter: `wss://host/api/ws?token=<jwt>`. The server validates the JWT during the WebSocket handshake. If the token is invalid or expired, the server rejects the connection with HTTP 401 before upgrading to WebSocket.

**Message scoping:** After authentication, the server associates the WebSocket connection with a `user_id` and `role`. Messages are scoped as follows:

- **Job progress updates** (upload progress, bulk download progress, sync status) are sent only to the user who initiated the job, identified by `user_id` on the `background_jobs` record.
- **Asset change notifications** (new upload, tag change by another user) are broadcast to all connected users for real-time UI updates.
- **Admin alerts** (Drive watcher failures, Shopify webhook verification failures, orphan detection) are sent only to connections where `role = 'admin'`.

**Token expiry during long-lived connections:** WebSocket connections outlive the 15-minute access token. The client must send an in-band `{ type: "token_refresh", token: "<new_jwt>" }` message before the current token expires. The server validates the new token and updates the connection's associated user context. If no refresh is received within 60 seconds of token expiry, the server closes the connection with close code `4001` (token expired), and the client must reconnect.

**Reconnection:** The frontend implements automatic reconnection with exponential backoff (starting at 1 second, max 30 seconds). On reconnect, the client re-authenticates with a current access token.

### 5.4 Error Handling Strategy

All backend operations follow a consistent error handling approach:

**Idempotency:** All write operations accept an optional `Idempotency-Key` header. The backend stores the key and result in Redis with a TTL. If a request is retried with the same key, the stored result is returned without re-executing the operation. This prevents duplicate uploads, duplicate tag changes, and duplicate Shopify pushes caused by network retries.

**Partial Failure Handling:** Operations that span multiple external systems (e.g. upload to Google Drive + create database record) use a cleanup-on-failure pattern:

1. Upload file to Google Drive.
2. If DB insert fails, delete the Drive file (via a cleanup job if the immediate delete also fails).
3. Orphaned resource detection: a periodic background job (`OrphanCleanupJob`, runs hourly) checks for Drive files that have no corresponding asset record and vice versa, logging discrepancies for admin review.

**Retry Logic:** All external API calls (Google Drive, Shopify) are wrapped in a retry utility with:
- Exponential backoff (starting at 500ms, max 30s).
- Jitter to prevent thundering herd.
- Maximum 3 retries for transient errors (5xx, network timeouts).
- Immediate failure for non-retryable errors (4xx except 429).

**Error Responses:** All API error responses follow a consistent JSON structure:

```json
{
  "error": {
    "code": "ASSET_NOT_FOUND",
    "message": "Asset with ID abc-123 not found or has been deleted.",
    "details": {}
  }
}
```

### 5.5 Google Drive Integration

#### Authentication

The system uses a Google Cloud **Service Account** with domain-wide delegation, added as a member of the Team Drive. This avoids per-user OAuth for backend operations while still respecting Team Drive permissions.

#### Rate Limiting

The Google Drive API enforces per-project quotas (typically 12,000 requests per 100 seconds). The Drive service layer includes:

- A token-bucket rate limiter that tracks request count per 100-second window.
- Automatic queuing of requests that would exceed the quota.
- Exponential backoff on 403 `rateLimitExceeded` and 429 responses.
- The initial Drive scan (indexing existing files) is processed as a background job with progress tracking, not a synchronous operation. It processes files in batches of 100 with a configurable delay between batches.

**Storage quota handling:** In addition to API rate limits, the Team Drive has a storage quota. If an upload fails with a `storageQuotaExceeded` error, the Drive service layer handles it as a distinct error type (not a retryable transient error). The backend returns a clear error response to the client (`DRIVE_STORAGE_FULL`) and the frontend displays: "Google Drive storage is full — contact your Drive administrator to free space or increase the quota." Subsequent upload attempts are allowed (the user may have freed space), but a persistent banner is shown in the Admin UI if the last upload failed with this error. The health endpoint also checks available Drive quota and reports a warning when usage exceeds 90%.

#### File Operations

| Operation       | Drive API Method           | Notes                                                   |
|-----------------|----------------------------|---------------------------------------------------------|
| Upload          | `drive.files.create`       | `multipart` upload with `parents: [teamDriveId]`. Resumable upload used for files > 5 MB. |
| Download/Stream | `drive.files.get` with `alt=media` | Piped directly to the HTTP response as a Node.js readable stream. |
| Thumbnail       | `drive.files.get` → `thumbnailLink` | Google auto-generates thumbnails. URLs are cached with a TTL (default: 30 minutes) and refreshed automatically. A forced refresh is triggered when the Changes API reports a file modification. |
| List/Scan       | `drive.files.list`         | Used during initial import to index existing files. Processed as a background job in batches. |
| Delete          | `drive.files.update` → trash | Assets are trashed, not permanently deleted, preserving Drive's recovery window. |
| Duplicate Check | `drive.files.get` → `md5Checksum` | Used during upload to detect duplicates by comparing file hash against existing assets. |

#### Thumbnail Caching

Rather than proxying every thumbnail request through the backend, the system caches Google Drive's `thumbnailLink` URLs on the asset record (`thumbnail_url` and `thumb_expires_at`). The frontend uses these URLs directly. When a cached URL is within 5 minutes of expiry, the backend refreshes it in the background. When the Drive Changes API reports a file modification, the cached thumbnail is invalidated immediately.

For video assets, a poster frame URL is extracted from Google Drive's thumbnail and cached the same way.

#### Folder Structure Convention

The CMS does not mandate a specific folder structure on Google Drive — it treats the entire Team Drive as a flat pool of files and relies on its own database for organisation. However, it respects any existing folder hierarchy and records the parent folder ID for reference. Users can optionally configure "watched folders" so that files added directly to Google Drive (outside the CMS) are automatically indexed on the next scan.

#### Sync Strategy

A background job (`DriveWatcherJob`) uses Google Drive's **Changes API** (`changes.list` with a stored `startPageToken`) to poll for new, modified, deleted, renamed, and moved files every 5 minutes. This keeps the CMS index in sync with manual changes made on Google Drive without requiring users to always upload through the CMS.

**Change type handling:**

- **New files** (file appears in Team Drive, no matching `google_drive_id` in the database): Create a new asset record with `uploaded_by = NULL` and empty tags. The asset appears in the library as an untagged file for the team to categorise.
- **Modified files** (content change detected via `md5Checksum` or `modifiedTime`): Invalidate the cached thumbnail. If the file size or dimensions changed, update the asset record.
- **Renamed files** (file `name` differs from stored `file_name`): Update `file_name` on the asset record. Log the rename in the audit log with the `drive_rename` action type.
- **Moved out of Team Drive** (file's `parents` no longer include the Team Drive ID, or file is trashed): Set the asset's `status` to `archived` and log the event with the `drive_moved_out` action type. Flag the asset for admin review via the WebSocket admin notification channel.
- **Moved into Team Drive** (file appears in a poll but has an existing `google_drive_id` in the database with `status = 'archived'` from a previous move-out): Restore the asset to `status = 'active'`.
- **Deleted files** (file permanently deleted from Drive, not just trashed): Set the asset to `status = 'deleted'`. The soft-delete preserves the audit trail and product links for reference.

**Backpressure and resilience:**

- The `startPageToken` is persisted in the database and updated only after each batch of changes is successfully processed (not after the entire poll). This ensures that if the job crashes mid-poll, it resumes from the last successfully processed point.
- Changes are processed in batches of 100. If a poll returns more than 100 changes (e.g. after an outage), the job processes them incrementally with checkpointing.
- If the job fails, it retries with exponential backoff. After 5 consecutive failures, it alerts the admin via the WebSocket notification channel and pauses until manually re-enabled.

### 5.6 Shopify Integration

#### Authentication

The Shopify connection uses a **Custom App** created in the store's admin. This provides a stable Admin API access token without requiring the OAuth install flow. The token is stored encrypted in environment variables.

#### Rate Limiting

The Shopify Admin API uses a leaky-bucket rate limit model. The Shopify service layer includes:

- A rate-aware request queue that tracks the current bucket fill level (returned in Shopify's `X-Shopify-Shop-Api-Call-Limit` response header).
- Automatic throttling when the bucket is more than 80% full.
- Retry with backoff on 429 responses.

#### Product Metadata Import Flow

This is the default sync operation, triggered manually or on a schedule. It imports product and variant metadata only — no image files.

```
1. CMS calls Shopify GraphQL Admin API → products (paginated, 250/page)
2. For each product:
   a. Upsert into `products` table (match on shopify_id)
   b. Store title, category, vendor, tags
   c. For each variant:
      - Upsert into `product_variants` table (match on shopify_variant_id)
      - Store SKU, title, price
3. Record sync timestamp
4. Refresh materialised search view
```

#### Product Image Import Flow (Separate, Optional)

This is a distinct operation that the user triggers explicitly. It downloads existing product images from Shopify and stores them on Google Drive.

```
1. For each product with images on Shopify:
   a. For each image (ordered by Shopify position):
      - Check for duplicate (by URL hash or file name) in existing assets
      - If not a duplicate:
        - Stream image from Shopify CDN → upload to Google Drive (streamed, not buffered)
        - Create asset record
        - Link via asset_products with:
          - role = "hero" for position 1, "gallery" for all others
          - sort_order = Shopify image position
          - variant_id populated if the Shopify image is associated with specific variants
        - If the Shopify image has alt text, store it as a tag: {"shopify_alt": "<alt text>"}
      - If duplicate found:
        - Skip and log
2. Report completion with counts (imported, skipped, failed)
```

This separation ensures that the common case (syncing product metadata) is fast and lightweight, while the heavier image import is opt-in.

#### Webhook Handling

The CMS registers for the following Shopify webhooks:

| Topic                | Action                                             |
|----------------------|----------------------------------------------------|
| `products/create`    | Create new product record and variants in CMS database. |
| `products/update`    | Update product and variant metadata (title, SKU, category, tags). |
| `products/delete`    | Soft-delete product record; unlink but preserve assets. |

All incoming webhooks are verified using the HMAC-SHA256 signature before processing.

**Webhook reliability:** Shopify retries failed webhooks up to 19 times over 48 hours, but events can still be lost if the CMS is unreachable for an extended period. To mitigate this, a **reconciliation job** (`ShopifyReconcileJob`) runs daily (configurable). It compares the CMS product list against a fresh Shopify catalogue pull and:
- Creates any products present in Shopify but missing from the CMS.
- Updates any products where the Shopify `updated_at` timestamp is newer than the CMS `synced_at`.
- Flags any products in the CMS that no longer exist in Shopify.

#### Pushing Assets to Shopify

When a user selects "Push to Shopify" on an asset that is linked to a product:

```
1. Stream file from Google Drive as a Node.js readable stream
2. For images (< 20 MB):
   - Pipe stream directly to Shopify REST Admin API: POST /products/{id}/images
   - Set alt text from asset tags (e.g. product name + colour)
   - Set position from asset_products.sort_order
3. For large images (> 20 MB) or video assets:
   - Use Shopify's staged upload flow via GraphQL `stagedUploadsCreate` mutation
   - Stream file from Drive directly to the staged upload URL (no in-memory buffering)
   - Complete the upload via GraphQL mutation
4. Store returned Shopify image/media ID on the asset record for future reference
5. Log the push in the audit log with success/failure status
```

**Important:** At no point is the entire file buffered in memory. For large files, the Drive readable stream is piped directly to the Shopify upload destination. If a push fails after the file has been uploaded to Shopify's CDN but before the product image record is created, the system retries the image creation call (idempotent by staged upload URL) and logs a warning for admin review.

---

## 6. Frontend Architecture

### 6.1 Technology Choices

| Component       | Choice                  | Rationale                                      |
|-----------------|-------------------------|-------------------------------------------------|
| Framework       | React 18 + TypeScript   | Component model suits the UI; strong typing reduces bugs. |
| Build tool      | Vite                    | Fast HMR, simple config, optimised production builds. |
| State management| Zustand                 | Lightweight, avoids Redux boilerplate for a small app. |
| Data fetching   | TanStack Query (React Query) | Handles caching, refetching, pagination, and optimistic updates. Provides the token refresh interceptor via a custom query client. |
| UI components   | shadcn/ui + Tailwind CSS | Accessible, composable components without heavy dependencies. |
| File previews   | Native `<img>`, `<video>`, `react-pdf` | No heavy viewer libraries needed for the core asset types. Text content rendered inline (plain text/Markdown) or in a sandboxed iframe (HTML). |

### 6.2 Token Refresh Interceptor

The frontend's HTTP client (Axios or a custom fetch wrapper) includes a transparent token refresh interceptor:

1. On any 401 response, the interceptor pauses the failed request.
2. It calls the `/api/auth/refresh` endpoint using the `httpOnly` refresh token cookie.
3. If the refresh succeeds, the new access token is stored in memory and the original request is retried.
4. If multiple requests fail simultaneously, only one refresh call is made; the others wait for it.
5. If the refresh fails (e.g. expired refresh token), the user is redirected to the login screen.

This ensures that long-running operations (large uploads, bulk downloads) are not interrupted by access token expiry.

### 6.3 Optimistic Concurrency Control

To handle concurrent edits by multiple users, the frontend includes the `updated_at` timestamp in every `PATCH` request. The backend compares this against the current `updated_at` value:

- If they match, the update proceeds and the timestamp is bumped.
- If they don't match (meaning another user has edited the record since this user loaded it), the backend returns a `409 Conflict` response.
- The frontend shows a notification: "This asset has been modified by another user. Please refresh and try again." with a one-click refresh button.

### 6.4 Key Views

#### Asset Library (Home)

The primary view. A filterable, searchable grid of asset thumbnails.

- **Left sidebar:** Faceted filters — product category, asset type (image/video/text/document), tag keys with expandable value lists (with live counts from the facets API), Shopify sync status, asset status (active/archived).
- **Main area:** Responsive grid of asset cards. Each card shows: thumbnail (loaded directly from cached Google Drive thumbnail URL), file name, primary SKU, and a quick-tag indicator. Click to open detail panel.
- **Top bar:** Free-text search input, bulk action toolbar (download selected, tag selected, push to Shopify), view toggle (grid/list).
- **Duplicate warning:** When uploading, if a matching file already exists (by name + size or hash), a modal shows the existing asset and asks the user to confirm whether to create a duplicate, replace the existing asset (creating a new version), or cancel.

#### Asset Detail Panel

A slide-over panel (or modal) showing:

- Full preview (image at full resolution, video player, rendered text/Markdown, sandboxed HTML, PDF viewer).
- Metadata: file name, type, dimensions/duration, file size, uploaded by, upload date, version number.
- Tags: displayed as editable chips grouped by key. Inline add/remove. Tag key autocomplete suggests existing keys; value autocomplete suggests existing values for the selected key.
- Linked products: list with link to product detail; drag to reorder (updates `sort_order`). Shows variant name if linked to a specific variant.
- Version history: if the asset has previous versions, a collapsible list showing each version with date, uploader, and a "View" link.
- Actions: Download, Replace (upload new version), Push to Shopify, Delete.
- Audit trail: collapsible timeline of changes with human-readable descriptions derived from the structured `details` payloads (e.g. "Alice changed colour from Red to Navy" rather than raw JSON).

#### Product Browser

A table/list of products synced from Shopify.

- Columns: title, primary SKU, category, vendor, variant count, asset count, last synced.
- Expand a product → shows variants with their individual SKUs.
- Click a product → shows all linked assets with drag-and-drop reordering per role.
- "Sync Products" button to pull latest metadata from Shopify.
- "Import Images" button (separate) to optionally import Shopify product images.

#### Upload View

- Drag-and-drop zone supporting multiple files.
- Pre-upload tagging: select a product (and optionally a variant), add tags — applied to all files in the batch.
- Duplicate detection: each file is checked against existing assets before upload begins. Duplicates are flagged with options to skip, replace, or proceed.
- Progress bar per file with Google Drive upload status.
- Post-upload confirmation with quick-edit option.
- File type and size validation happens client-side (for immediate feedback) and is enforced again server-side.

#### Admin / Settings

- User management (invite by email, assign roles).
- Google Drive connection status, folder watcher config, and Drive API quota usage.
- Shopify connection status, sync schedule, webhook health, and reconciliation job status.
- Tag key management (define "official" keys with suggested values for consistency; free-form still allowed).
- Background job dashboard showing running and recent jobs with status and progress.
- System health overview (DB, Redis, Drive, Shopify connectivity).

---

## 7. Search Implementation

Search is one of the most critical features of this system. The implementation uses PostgreSQL's built-in capabilities via a materialised view to avoid adding a separate search engine for a dataset of this size.

### 7.1 Query Strategy

All search queries run against the `asset_search_mv` materialised view, which pre-joins and flattens asset, product, variant, and tag data into a single row per asset. This eliminates the expensive multi-table joins that would otherwise be required on every search.

When a user types a search term, the backend constructs a query that:

1. **Matches against the pre-computed `search_text` column** using trigram similarity (`%` operator from `pg_trgm`), which covers file names, product titles, SKUs, and all tag values in a single indexed column.

2. **Ranks results** using a weighted scoring function. Weights are defined as configurable constants (not hardcoded in SQL), defaulting to:
   - SKU exact match: weight 10
   - Product title match: weight 5
   - Tag value match (via `tag_text` column): weight 3
   - File name match: weight 1

   The `tag_text` column (containing only concatenated tag values) is checked separately from the general `search_text` column. This ensures that a match in tag values is scored distinctly from a match in file names or product titles, even when the same words appear in multiple fields.

3. **Applies tag filters** as JSONB containment queries (`tags @> '{"colour": "Navy"}'`) which use the GIN index.

4. **Applies facet filters** (asset type, status, category) as `WHERE` clauses.

### 7.2 Example Generated Query

For a search: `q=navy polo&tags[season]=AW26&type=image`

```sql
WITH scored AS (
    SELECT
        asset_id,
        file_name,
        asset_type,
        tags,
        created_at,
        product_titles,
        skus,
        GREATEST(
            similarity(search_text, 'navy polo'),
            COALESCE((
                SELECT MAX(similarity(sku, 'navy polo') * 10)
                FROM unnest(skus) AS sku
            ), 0),
            COALESCE((
                SELECT MAX(similarity(pt, 'navy polo') * 5)
                FROM unnest(product_titles) AS pt
            ), 0),
            COALESCE(similarity(tag_text, 'navy polo') * 3, 0)
        ) AS relevance
    FROM asset_search_mv
    WHERE status = 'active'
      AND asset_type = 'image'
      AND tags @> '{"season": "AW26"}'
      AND search_text % 'navy polo'
)
SELECT *
FROM scored
WHERE relevance > 0.1
ORDER BY relevance DESC
LIMIT 50 OFFSET 0;
```

This query runs against a single materialised view with no joins, uses the GIN trigram index on `search_text` for the similarity filter, uses the GIN trigram index on `tag_text` for tag-specific relevance scoring, and uses the GIN JSONB index for tag filtering.

### 7.3 Materialised View Refresh

The `asset_search_mv` view is refreshed using a two-tier strategy:

- **On-demand (per-operation):** After any single-asset write operation (upload, tag change, product link/unlink, version replace), the backend triggers `REFRESH MATERIALIZED VIEW CONCURRENTLY asset_search_mv` immediately. For datasets under ~100,000 assets, this completes in low hundreds of milliseconds and ensures the search index reflects the change within the same request cycle. The `CONCURRENTLY` keyword means this does not block concurrent reads.
- **On a schedule:** Every 60 seconds via a lightweight BullMQ repeating job, as a consistency backstop. This catches any edge cases where an on-demand refresh was skipped (e.g. direct database changes, Drive watcher updates).
- **After bulk operations:** Bulk tag changes and Shopify syncs trigger an immediate refresh after the entire batch completes (not per-item).
- **Frontend optimistic updates:** In addition to the server-side refresh, the frontend uses TanStack Query's optimistic mutation support to immediately update the local cache with the expected result of the operation. This means the user sees their change reflected in the UI instantly, before the server-side refresh even completes. The next background refetch confirms or corrects the optimistic state.
- The `UNIQUE INDEX` on `asset_id` is required for `REFRESH MATERIALIZED VIEW CONCURRENTLY` to work.

For datasets exceeding ~100,000 assets, on-demand refresh per-operation may become too slow. At that scale, switch to scheduled-only refresh (every 30–60 seconds) and rely more heavily on the frontend optimistic updates for immediate feedback. PostgreSQL `tsvector`/`tsquery` full-text search can supplement trigram similarity for faster queries at that volume.

### 7.4 Performance Considerations

- **Trigram indexes** (`gin_trgm_ops`) on `search_text` and `tag_text` make `%` (similarity threshold) and `similarity()` queries use index scans. The separate `tag_text` index allows tag-specific relevance scoring without additional cost.
- **JSONB GIN index** on `tags` makes containment queries (`@>`) fast regardless of how many tag keys exist.
- The materialised view eliminates per-query joins across 4+ tables, reducing search latency from hundreds of milliseconds to low tens of milliseconds for typical queries.
- If full-text search requirements grow (e.g. searching inside text file content), PostgreSQL's `tsvector` / `tsquery` can be added to the materialised view without changing the architecture.
- Search weight configuration is stored in the application config (environment variable or database setting) and injected into query construction at runtime, allowing tuning without code changes.

---

## 8. Authentication & Authorisation

### 8.1 Auth Flow

The system supports two login methods:

1. **Google OAuth 2.0** (recommended for teams already on Google Workspace): users sign in with their Google account. The backend verifies the ID token and checks the user's email against the `users` table. If the user exists but has `status = 'deactivated'`, the login is rejected with a clear error message.
2. **Email + password** (fallback): for users without Google accounts. Passwords are hashed with `argon2`. Deactivated users are rejected at login.

On successful login, the backend issues:
- An **access token** (JWT, 15-minute expiry) containing `user_id` and `role`.
- A **refresh token** (opaque, single-use, stored as a hash in the `refresh_tokens` table, 7-day expiry) sent as an `httpOnly`, `Secure`, `SameSite=Strict` cookie.

### 8.2 Refresh Token Rotation

Refresh tokens are **single-use**. Each time a refresh token is presented:

1. The backend looks up the token hash in the `refresh_tokens` table.
2. If the token is found and `used = false`:
   - Mark it as `used = true`.
   - Issue a new access token and a new refresh token.
   - Store the new refresh token hash in the database.
3. If the token is found and `used = true` (indicating potential theft — someone is replaying a token that was already used):
   - Invalidate **all** refresh tokens for that user.
   - The user must re-authenticate.
   - Log a security warning in the audit log.
4. If the token is not found or expired:
   - Return 401. The user must re-authenticate.

This approach ensures that if a refresh token is intercepted and used by an attacker, the legitimate user's next refresh attempt will trigger a full invalidation, limiting the window of compromise.

### 8.3 Role Permissions

| Action                       | Viewer | Editor | Admin |
|------------------------------|--------|--------|-------|
| Browse and search assets     | Yes    | Yes    | Yes   |
| Preview and download assets  | Yes    | Yes    | Yes   |
| Upload assets                | No     | Yes    | Yes   |
| Add/edit/remove tags         | No     | Yes    | Yes   |
| Link assets to products      | No     | Yes    | Yes   |
| Delete assets (soft)         | No     | No     | Yes   |
| Push assets to Shopify       | No     | No     | Yes   |
| Approve Shopify push queue   | —      | —      | Yes   |
| Manage users and roles       | No     | No     | Yes   |
| Configure integrations       | No     | No     | Yes   |
| View audit log               | No     | No     | Yes   |
| View background job status   | No     | Yes    | Yes   |
| Deactivate users             | No     | No     | Yes   |

**Note on Shopify push permissions:** Pushing assets to Shopify directly affects a live store. This action is restricted to Admin users. Editors can *request* a push (which enters a queue), but only Admins can approve and execute it. This prevents accidental publication of unreviewed assets.

**Note on user offboarding:** When a team member leaves, an Admin sets their account to `status = 'deactivated'` rather than deleting the user record. Deactivated users cannot log in and all their active refresh tokens are invalidated immediately. Their existing assets and audit log entries are preserved with the original `user_id` for accountability. The `ON DELETE SET NULL` foreign keys on `assets.uploaded_by` and `audit_log.user_id` support hard deletion as a future option if needed, but soft-deactivation is the recommended workflow.

---

## 9. Infrastructure & Deployment

### 9.1 Deployment Architecture

The entire system runs as a Docker Compose stack on a single server. All services — including the reverse proxy — are defined in the stack.

```yaml
# docker-compose.yml
services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    restart: unless-stopped
    depends_on: [app, frontend]

  app:
    build: ./backend
    expose: ["3000"]
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  worker:
    build: ./backend
    command: node worker.js
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(0)"]
      interval: 30s
      timeout: 5s
      retries: 3

  frontend:
    build: ./frontend
    expose: ["80"]
    restart: unless-stopped

  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./backups:/backups
    environment:
      POSTGRES_DB: cms
      POSTGRES_USER: cms_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    command:
      - "postgres"
      - "-c" 
      - "wal_level=replica"
      - "-c"
      - "archive_mode=on"
      - "-c"
      - "archive_command=test -d /backups/wal || mkdir -p /backups/wal; cp %p /backups/wal/%f"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cms_user -d cms"]
      interval: 10s
      timeout: 5s
      retries: 5

  backup-sync:
    image: rclone/rclone:latest
    volumes:
      - ./backups:/backups:ro
      - ./rclone.conf:/config/rclone/rclone.conf:ro
    entrypoint: /bin/sh
    command: >
      -c "while true; do
        rclone sync /backups remote:cms-backups --log-level INFO;
        sleep 3600;
      done"
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: >
      redis-server
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
      --appendonly yes
    volumes:
      - redisdata:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

volumes:
  pgdata:
  redisdata:
  caddy_data:
  caddy_config:
```

#### Caddyfile

```
cms.yourdomain.com {
    # WebSocket endpoint — Caddy handles the upgrade automatically for reverse_proxy
    handle /api/ws {
        reverse_proxy app:3000
    }
    handle /api/* {
        reverse_proxy app:3000
    }
    handle {
        reverse_proxy frontend:80
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
    }
}

# Separate origin for HTML text previews (sandboxed, no script execution)
preview.cms.yourdomain.com {
    reverse_proxy app:3000

    header {
        Content-Security-Policy "default-src 'none'; style-src 'unsafe-inline'; img-src *"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
    }
}
```

Caddy automatically obtains and renews TLS certificates via Let's Encrypt. The `/api/ws` route is listed first because Caddy evaluates `handle` blocks in order of specificity; in practice `/api/ws` would also match `/api/*`, but the explicit block documents the WebSocket endpoint and allows future WebSocket-specific configuration (e.g. longer timeouts) without affecting REST routes.

### 9.2 Environment Variables

```
# Google Drive
GOOGLE_SERVICE_ACCOUNT_KEY=<base64-encoded JSON key>
GOOGLE_TEAM_DRIVE_ID=<team drive ID>

# Shopify
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_API_TOKEN=<token>
SHOPIFY_WEBHOOK_SECRET=<secret>

# Database
DATABASE_URL=postgresql://cms_user:password@db:5432/cms

# Redis
REDIS_URL=redis://redis:6379

# Auth
JWT_SECRET=<random 64-char string>
GOOGLE_OAUTH_CLIENT_ID=<client ID>
GOOGLE_OAUTH_CLIENT_SECRET=<client secret>

# App
APP_URL=https://cms.yourdomain.com
FRONTEND_ORIGIN=https://cms.yourdomain.com
NODE_ENV=production

# File limits (optional overrides)
MAX_IMAGE_SIZE_MB=100
MAX_VIDEO_SIZE_MB=1024
MAX_TEXT_SIZE_MB=10

# Search weights (optional overrides)
SEARCH_WEIGHT_SKU=10
SEARCH_WEIGHT_PRODUCT_TITLE=5
SEARCH_WEIGHT_TAG_VALUE=3
SEARCH_WEIGHT_FILE_NAME=1

# Bulk download limits (optional overrides)
BULK_DOWNLOAD_MAX_ASSETS=500
BULK_DOWNLOAD_MAX_SIZE_GB=5
BULK_DOWNLOAD_TIMEOUT_HOURS=2
BULK_DOWNLOAD_RETENTION_HOURS=24

# Retention policies (optional overrides)
AUDIT_LOG_RETENTION_DAYS=180
COMPLETED_JOB_RETENTION_DAYS=7
FAILED_JOB_RETENTION_DAYS=30

# Initial admin seeding (first run only — see §9.6)
SEED_ADMIN_EMAIL=

# Monitoring
LOG_LEVEL=info
```

### 9.3 Recommended Server Spec

For a team of 2–10 users with up to 50,000 assets:

- **CPU:** 2–4 cores
- **RAM:** 4–8 GB
- **Storage:** 40 GB for the application, database, Redis, WAL archives, and backup staging (files live on Google Drive, not on the server)
- **Network:** Decent bandwidth for streaming files from Google Drive to users

A modest cloud VM (e.g. a DigitalOcean Droplet, Hetzner Cloud, or equivalent) is more than adequate.

### 9.4 Backup Strategy

- **Database (full):** Automated `pg_dump` every 6 hours, compressed and stored to a separate location (e.g. a different Google Drive folder or object storage bucket). Retained for 30 days.
- **Database (continuous):** PostgreSQL WAL archiving is enabled (see `docker-compose.yml` above). WAL files are archived to the `/backups/wal/` directory. The `archive_command` includes a `mkdir -p` to ensure the directory exists before the first write. A `backup-sync` sidecar container (using `rclone`) syncs the `/backups` directory to an off-host destination (e.g. object storage, a separate Google Drive folder) every hour. This protects against both logical errors (recoverable via point-in-time restore from local WAL) and hardware failures (recoverable from the off-host copy). The `rclone.conf` must be configured with the target remote before deployment.
- **Files:** Covered by Google Drive's own versioning and trash recovery (30-day window).
- **Configuration:** All environment config stored in a `.env` file that is version-controlled (encrypted) or managed via a secrets manager. The Docker Compose file, Caddyfile, and `rclone.conf` are version-controlled.

### 9.5 Monitoring & Logging

- **Health endpoint:** `/api/health` checks connectivity to PostgreSQL, Redis, and Google Drive API. Returns a structured JSON response with per-dependency status. This endpoint is used by Docker health checks and can be polled by external uptime monitors.
- **Logging:** All services log to stdout in structured JSON format. Docker's logging driver is configured to ship logs to a centralised destination (e.g. `json-file` driver with log rotation for simple setups, or `fluentd`/`loki` for more capable setups).
- **Metrics:** The Fastify backend exposes basic Prometheus-compatible metrics at `/api/metrics` (request count, latency, error rate, active WebSocket connections, background job queue depth). A lightweight Prometheus + Grafana stack can be added alongside the Compose stack if desired, but is not required for initial launch.
- **Alerts:** Critical failures (database connection loss, Redis unavailability, Drive watcher repeated failures, Shopify webhook verification failures) are surfaced via the admin WebSocket notification channel and logged at `error` level. For production use, an external alerting integration (e.g. email, Slack webhook, PagerDuty) is recommended.

### 9.6 Initial Setup & Admin Seeding

The system requires at least one Admin user before anyone can log in (Google OAuth and email/password both check the `users` table). To bootstrap the first Admin account, the backend checks on startup whether the `users` table is empty. If it is, and the `SEED_ADMIN_EMAIL` environment variable is set, the backend automatically creates an Admin user with that email address and logs the action. This is a one-time operation — once the first Admin exists, subsequent users are managed through the Admin UI.

Alternatively, a CLI command is provided:

```bash
docker compose exec app node scripts/seed-admin.js --email admin@example.com
```

This command creates an Admin user if no users exist, or exits with an error if users already exist (preventing accidental privilege escalation).

### 9.7 Initial Google Drive Indexing Workflow

When the CMS connects to an existing Team Drive for the first time, the initial Drive scan (described in §5.5) indexes all existing files as a background job. These files will have empty tags, no product links, and `uploaded_by = NULL`. For teams migrating from a folder-based workflow, this raw index is overwhelming and not immediately useful.

To address this, the system provides a **folder-to-tag mapping** configuration step during initial setup:

1. After the initial Drive scan completes, the Admin UI shows a list of all top-level folders found on the Team Drive, with file counts per folder.
2. The Admin can map each folder to one or more tags — e.g. "files in `/Product Photos/Summer 2026/` should receive tags `season: SS26` and `category: Product Photos`".
3. The system applies the tag mappings as a bulk operation and triggers a materialised view refresh.
4. Unmapped folders are left as-is; their assets appear in the library as untagged files.

This mapping is a one-time operation stored in the database for reference but not re-applied automatically. After the initial setup, all new files are tagged through the normal CMS workflow or via the Drive watcher (which creates untagged records for manually-added files).

For teams with deeply nested folder structures, the folder-to-tag mapping supports recursive application (e.g. "all files under `/Campaigns/` receive `category: Campaign`").

Additionally, the upload view supports **bulk tagging of existing untagged assets**: an Admin or Editor can filter the library to `uploaded_by IS NULL` (i.e. Drive-scanned files), select a batch, and apply tags in a single operation.

---

## 10. Security Considerations

- **API access:** All endpoints require valid JWT. Tokens are short-lived (15 min) with single-use refresh token rotation.
- **CORS:** Restricted to the specific frontend origin (`FRONTEND_ORIGIN` env var). No wildcard origins.
- **Shopify webhooks:** Verified via HMAC-SHA256 signature comparison before any processing.
- **Google Drive:** Service account has scoped access to only the specified Team Drive.
- **File uploads:** MIME type validated server-side (not just by extension). File type allowlist and maximum file size enforced per type (see section 4.4).
- **SQL injection:** Prevented by parameterised queries (Knex enforces this by default).
- **Rate limiting:** Applied to all API endpoints with per-user limits (see §5.3). Auth endpoints and bulk operations have stricter limits. The search endpoint is rate-limited to 30 requests per minute per user to prevent expensive trigram queries from degrading performance. External API calls (Drive, Shopify) are rate-limited client-side to stay within quotas.
- **HTTPS:** Required in production. Caddy handles automatic certificate management. Security headers (HSTS, X-Content-Type-Options, X-Frame-Options) are set at the reverse proxy level.
- **Secrets:** Stored in environment variables, never committed to source control.
- **Refresh token theft detection:** Single-use rotation with full invalidation on reuse (see section 8.2).
- **Optimistic concurrency:** `updated_at` comparison on all write operations prevents silent data loss from concurrent edits.
- **Content Security Policy:** HTML text previews are rendered in sandboxed iframes served from a separate origin (`preview.cms.yourdomain.com`). The iframe uses `sandbox=""` (no flags — no scripts, no same-origin access). This prevents uploaded HTML content from accessing the parent page's cookies, storage, or making API calls, even if the HTML contains malicious JavaScript. The preview subdomain is configured in Caddy to proxy to the backend's preview endpoint, which streams the HTML content with a restrictive `Content-Security-Policy` header (`default-src 'none'; style-src 'unsafe-inline'; img-src *`). If a separate subdomain is not feasible, `sandbox="allow-same-origin"` can be used as a fallback, but only if `allow-scripts` is never added — the two flags together negate the sandbox.
- **Idempotency:** Write operations accept `Idempotency-Key` headers to prevent duplicate side effects from retried requests.

---

## 11. Development Roadmap

### Phase 1 — Core Platform (Weeks 1–4)

- Set up project scaffolding (backend + frontend + Docker Compose with Caddy, backup-sync sidecar, health checks, and restart policies).
- Implement database schema, migrations (including partial unique indexes on `asset_products`), and materialised search view (with `tag_text` column).
- Build Google Drive service with rate limiting, exponential backoff, storage quota detection, and streaming.
- Build Asset API (CRUD, JSONB tagging, search via materialised view with on-demand refresh for single-asset operations).
- Build frontend: asset library grid, search bar with facets, asset detail panel, upload flow with duplicate detection. Implement TanStack Query optimistic updates for immediate search consistency.
- Implement JWT auth with Google OAuth, single-use refresh token rotation, and frontend token interceptor. Include admin seeding (CLI + env var).
- Implement WebSocket endpoint (`/api/ws`) with JWT authentication, role-based message scoping, and in-band token refresh.
- Implement optimistic concurrency control.
- Build error handling framework (idempotency, cleanup jobs, structured error responses).
- Implement API rate limiting across all endpoints (auth, search, bulk, standard CRUD).

### Phase 2 — Shopify Integration (Weeks 5–6)

- Build Shopify service with rate-aware request queuing.
- Implement product metadata sync (separate from image import).
- Implement optional product image import as a background job (with Shopify position → sort_order mapping, role assignment, and alt text preservation).
- Build Product Browser UI with variant display.
- Implement asset-to-product (and variant) linking with role and sort order.
- Implement "Push to Shopify" with streaming (no in-memory buffering) and Admin approval queue.
- Set up webhook handler with HMAC verification.
- Build reconciliation job for webhook reliability.

### Phase 3 — Polish & Team Features (Weeks 7–8)

- Role-based access control enforcement across all endpoints and UI. User deactivation workflow.
- Structured audit logging with human-readable detail rendering and audit log API endpoint.
- Bulk operations (bulk download as background job with size/count limits and notification, bulk tag, bulk push request).
- Drive change watcher with backpressure handling, checkpoint persistence, and rename/move detection.
- Asset versioning (transactional replace with link-moving, version history UI).
- Tag key management / autocomplete suggestions.
- Background job dashboard.
- Initial Drive indexing workflow with folder-to-tag mapping UI and bulk tagging of untagged assets.

### Phase 4 — Hardening & Launch (Weeks 9–10)

- Security audit (rate limiting, input validation, CORS, CSP with separate preview origin, refresh token rotation).
- Performance testing with realistic data volume (50,000 assets, concurrent users).
- Backup automation (6-hourly pg_dump + WAL archiving verification + off-host sync via rclone).
- Monitoring setup (health endpoint with Drive quota check, structured logging, basic metrics).
- Orphaned resource cleanup job.
- Retention policy jobs (audit log cleanup, background job cleanup, bulk download ZIP cleanup).
- Documentation (user guide + API reference).
- Deploy to production server.

---

## 12. Future Considerations

These features are not in scope for the initial build but are architecturally accounted for:

- **AI-powered auto-tagging:** Run image classification (e.g. Google Vision API or a local model) on upload to suggest tags automatically. The JSONB `tags` column supports this with no schema changes.
- **Multi-store Shopify support:** The `products` table can be extended with a `store_id` column to support multiple Shopify stores.
- **Semantic search:** Store text embeddings in `pgvector` and enable "find similar assets" queries.
- **Workflow / approval:** Expand the Shopify push approval queue into a general-purpose approval workflow for content review.
- **Video transcoding:** Add a transcoding pipeline (e.g. FFmpeg in a worker container) to generate web-friendly preview versions of large raw video files.
- **In-app text editing:** Add a simple Markdown editor for creating and editing text content directly within the CMS, rather than requiring file uploads.
- **Advanced analytics:** Dashboard showing asset usage statistics (most downloaded, most pushed to Shopify, tag coverage gaps).

---

## Appendix A: Key API Libraries & Versions

| Library                | Version   | Purpose                          |
|------------------------|-----------|----------------------------------|
| `fastify`              | ^5.x      | HTTP server framework            |
| `knex`                 | ^3.x      | SQL query builder + migrations   |
| `pg`                   | ^8.x      | PostgreSQL driver                |
| `googleapis`           | ^140.x    | Google Drive API client          |
| `@shopify/shopify-api` | ^11.x     | Shopify Admin API client         |
| `bullmq`              | ^5.x      | Background job queue             |
| `jsonwebtoken`         | ^9.x      | JWT creation and verification    |
| `argon2`               | ^0.40.x   | Password hashing                 |
| `archiver`             | ^7.x      | ZIP stream generation            |
| `bottleneck`           | ^2.x      | Rate limiter for external API calls |
| `react`                | ^18.x     | Frontend UI framework            |
| `@tanstack/react-query`| ^5.x      | Data fetching and caching        |
| `zustand`              | ^5.x      | Lightweight state management     |
| `axios`                | ^1.x      | HTTP client with interceptor support |

---

## Appendix B: Google Drive API Scopes Required

```
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/drive.readonly
```

The `drive.file` scope allows the service account to manage files it has created. The `drive.readonly` scope allows indexing existing files on the Team Drive. If the CMS needs to manage (move/trash) files it did not create, the broader `https://www.googleapis.com/auth/drive` scope is required instead.

---

## Appendix C: Shopify API Scopes Required

```
read_products, write_products
read_product_images, write_product_images
read_files, write_files
```

These scopes are configured when creating the Custom App in the Shopify admin. The `files` scopes are needed for staged uploads of video content.

---

## Appendix D: Changelog from v1.0

| Area | Change | Rationale |
|------|--------|-----------|
| Data model | Replaced `asset_tags` key-value table with JSONB `tags` column on `assets` | Eliminates expensive self-joins for multi-tag filtering; JSONB GIN index handles filtering and facet counting natively. |
| Data model | Added `product_variants` table | Correctly models Shopify's product/variant hierarchy; enables per-variant SKU search and asset linking. |
| Data model | Changed `asset_products` to surrogate PK with `UNIQUE (asset_id, product_id, role)` | Allows a single asset to serve multiple roles for the same product. |
| Data model | Added `status` column to `assets` | Enables proper soft-deletion and archiving. |
| Data model | Added `version` and `parent_asset_id` to `assets` | Basic asset versioning to avoid re-tagging when replacing a file. |
| Data model | Added `refresh_tokens` table | Supports single-use refresh token rotation for theft detection. |
| Data model | Added `background_jobs` table | Tracks long-running operations (bulk download, sync) with progress. |
| Data model | Defined supported file types with size limits | Prevents upload of unsupported or excessively large files. |
| Data model | Defined structured audit log detail schemas | Enables human-readable audit trail rendering. |
| Search | Added materialised search view (`asset_search_mv`) from day one | Eliminates multi-table joins on every search query; dramatically improves performance. |
| Search | Fixed `DISTINCT ON` ordering bug in example query | Previous query ordered by UUID, not relevance. |
| Search | Made search weights configurable | Allows tuning without code changes. |
| Backend | Added Google Drive API rate limiting and backoff | Prevents quota exhaustion during bulk operations and initial scan. |
| Backend | Added Shopify rate-aware request queuing | Respects leaky-bucket rate limits. |
| Backend | Separated Shopify product metadata sync from image import | Common case (metadata) is fast; image import is opt-in. |
| Backend | Changed Shopify push to streaming (no in-memory buffering) | Prevents OOM crashes on large video uploads. |
| Backend | Added webhook reconciliation job | Handles missed webhooks during outages. |
| Backend | Added idempotency key support | Prevents duplicate side effects from retried requests. |
| Backend | Added structured error handling and cleanup jobs | Handles partial failures across Google Drive and database. |
| Backend | Added Drive watcher backpressure and checkpointing | Handles large backlogs after outages without data loss. |
| Backend | Added thumbnail URL caching with TTL and invalidation | Reduces Drive API calls; ensures fresh thumbnails after file changes. |
| Auth | Added single-use refresh token rotation | Detects and mitigates token theft. |
| Auth | Restricted Shopify push to Admin role with approval queue | Prevents accidental publication to live store. |
| Auth | Added CORS configuration | Required for split frontend/backend deployment; was missing entirely. |
| Frontend | Added token refresh interceptor | Prevents auth failures during long-running operations. |
| Frontend | Added optimistic concurrency control | Prevents silent data loss from concurrent edits. |
| Frontend | Added duplicate detection on upload | Prevents accidental duplicate assets. |
| Frontend | Added background job dashboard | Visibility into long-running operations. |
| Infrastructure | Added Caddy reverse proxy to Docker Compose stack | TLS termination was described but not defined; now included. |
| Infrastructure | Added health checks and restart policies for all services | Automatic recovery from transient failures. |
| Infrastructure | Added Redis memory limit and eviction policy | Prevents Redis OOM from job accumulation. |
| Infrastructure | Enabled PostgreSQL WAL archiving | Supports point-in-time recovery between full backups. |
| Infrastructure | Increased backup frequency to every 6 hours | Reduces maximum data loss window. |
| Infrastructure | Added monitoring and logging strategy | Health endpoint, structured logging, optional metrics. |
| Infrastructure | Increased storage recommendation to 40 GB | Accounts for WAL archives and more frequent backups. |

---

## Appendix E: Changelog from v2.0

| Area | Change | Rationale |
|------|--------|-----------|
| Search | On-demand materialised view refresh after single-asset writes | Users saw stale search results for up to 60 seconds after uploading or tagging; now refreshed immediately. |
| Search | Added frontend optimistic updates via TanStack Query | Provides instant visual feedback while server-side MV refresh completes. |
| Search | Added `tag_text` column to materialised view with separate trigram index | Enables distinct scoring of tag-value matches vs general search_text matches; improves relevance for tag-heavy queries. |
| Search | Updated example query to include `tag_text` similarity scoring | Tag values now contribute to relevance scoring independently. |
| Backend | Added WebSocket authentication and role-based message scoping (§5.3) | WebSocket was unspecified; now requires JWT, scopes messages by user/role, and supports in-band token refresh. |
| Backend | Added per-endpoint API rate limiting including search (§5.3) | Search endpoint was unprotected; now limited to 30 req/min per user. All endpoints have defined limits. |
| Backend | Added audit log API endpoint (`GET /api/audit-log`) | Audit log was defined but had no query API; now queryable by entity, action, user, and date range. |
| Backend | Added bulk download limits (500 assets, 5 GB, 2-hour timeout) | Prevents unbounded resource consumption from large bulk downloads. |
| Backend | Added bulk download ZIP cleanup (24-hour retention) | Prevents disk exhaustion from accumulated temporary files. |
| Backend | Drive watcher now handles renames, moves in/out of Team Drive | Previously only handled new, modified, and deleted files; renames caused stale `file_name`; moves caused orphaned records. |
| Backend | Added Google Drive storage quota detection and user-facing error | `storageQuotaExceeded` was unhandled; now returns a clear error and surfaces a warning in the Admin UI. |
| Backend | Shopify image import now maps position → sort_order/role and preserves alt text | Imported images previously lost their Shopify ordering and alt text metadata. |
| Backend | Asset versioning is now transactional; product links are moved, not copied | Prevents partial failure leaving orphaned links; moving is simpler and avoids ambiguity about which asset is canonical. |
| Data model | Changed `asset_products` unique constraint to include `variant_id` via partial indexes | Previous `(asset_id, product_id, role)` constraint blocked legitimate variant-level links (e.g. different colour swatches for different variants). |
| Data model | Added `status` column to `users` table for soft-deactivation | Enables user offboarding without deleting records; deactivated users can't log in but their audit trail is preserved. |
| Data model | Changed `assets.uploaded_by` and `audit_log.user_id` FK to `ON DELETE SET NULL` | Prevents `RESTRICT` errors when deleting users; supports future hard-deletion if needed. |
| Data model | Added audit log retention policy (default 180 days) with cleanup job | Prevents unbounded table growth. |
| Data model | Added background job cleanup policy (7 days completed, 30 days failed) | Prevents unbounded table growth. |
| Data model | Added `drive_rename`, `drive_moved_out`, and `user_deactivate` audit actions | Covers new operational events from Drive watcher and user management improvements. |
| Auth | Login flow now rejects deactivated users with clear error | Previously no concept of deactivated users. |
| Auth | Added user offboarding documentation | Defines the expected workflow when a team member leaves. |
| Security | HTML preview CSP changed from `sandbox="allow-same-origin"` to separate-origin iframe | `allow-same-origin` on the main domain could allow uploaded HTML to access cookies/storage; separate origin eliminates this risk. |
| Infrastructure | Caddyfile now explicitly routes `/api/ws` for WebSocket connections | WebSocket path was undocumented; now explicit for clarity and future configuration. |
| Infrastructure | Added `backup-sync` sidecar container using rclone for off-host backup | WAL archives on the same host don't protect against hardware failure; now synced to external storage hourly. |
| Infrastructure | `archive_command` now includes `mkdir -p` for WAL directory | Directory didn't exist on first run, causing silent archive failures. |
| Infrastructure | Added initial admin seeding (CLI + env var) | No way to create the first Admin user without direct DB access; now handled via startup check and CLI command. |
| Infrastructure | Added initial Drive indexing workflow with folder-to-tag mapping | Existing Drive files were indexed as untagged/unlinked assets, making the initial CMS experience overwhelming. |
| Roadmap | Updated all phases to include new tasks | Reflects all v3 changes across the development timeline. |
