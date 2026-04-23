# Shopify CMS — Digital Asset Manager

A self-hosted CMS for managing product images and digital assets, backed by Google Team Drive and integrated with Shopify. Built with Node.js, Fastify, PostgreSQL, and React.

## Documentation

Full setup and usage docs are in [`digital-asset-cms/README.md`](digital-asset-cms/README.md), including:

- [Quick Start](digital-asset-cms/README.md#quick-start) — get running in under 10 minutes
- [Prerequisites](digital-asset-cms/README.md#prerequisites) — Google service account, Shopify app, OAuth credentials
- [Configuration](digital-asset-cms/README.md#configuration) — all environment variables
- [User Guide](digital-asset-cms/README.md#user-guide) — uploading, tagging, searching, Shopify sync
- [API Reference](digital-asset-cms/README.md#api-reference)
- [Troubleshooting](digital-asset-cms/README.md#troubleshooting)

## Quick look

```bash
cd digital-asset-cms
cp .env.example .env
# fill in .env (see Prerequisites in the docs above)
docker compose up -d
```

## Internal docs

- [`cms-architecture-v3.md`](cms-architecture-v3.md) — system architecture and design decisions
- [`development-plan.md`](development-plan.md) — staged build plan and test gates
