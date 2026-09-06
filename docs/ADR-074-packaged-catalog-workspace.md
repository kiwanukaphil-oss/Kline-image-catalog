# ADR-074: Package the catalog workspace inside the POS runtime

Status: Accepted for local integration; staging and production release pending.
Date: 2026-09-06

## Context

The redesigned K-Line frontend consumes branch-scoped delivery, draft, receiving and stock routes. Its initial host was deliberately restricted to a disposable local database. A production server must load these routes through the POS security middleware and migration process, without depending on a sibling source checkout at runtime.

## Decision

The catalog repository owns a small private npm package containing only workspace runtime modules. The POS backend installs a versioned tarball from its own `vendor` directory using a locked file dependency. Release artifacts are generated with `npm pack`; test image storage, fixture credentials, test hosts, source patches and development scripts are excluded. The package has no independent Express, database or authentication dependency: its factory receives the installed POS backend path and reuses that installation's modules.

The normal POS server mounts `/api/catalog-workspace` after its shared security middleware and before the 404 handler when `CATALOG_WORKSPACE_ENABLED=true`. The default is disabled for a controlled rollout. Invalid flag values fail environment validation. Package/contract errors fail startup instead of silently falling back. CORS continues to use the existing exact origin allowlist and branch headers; there is no permissive secondary host.

Migration 106 adds the two delivery-organization tables using the existing POS migration manifest and preflight (ADR-026/052). Migration 001 in the catalog source remains a preserved local fixture reference. Production uses migration 106 only. Catalog items remain the evidence source and POS remains the stock authority (ADR-062/069/073).

## Validation and release

Canonical Jest/supertest checks use real PostgreSQL to verify the normal mounted server, authentication, permissions, branch scope, CORS, sanitization, package contents, migration tracking and receiving. The local workspace/browser harness also uses the normal POS app with this flag enabled, retaining only its isolated image-storage fixture. Fresh and existing fixture databases both apply migration 106 through the migration service.

The package tarball must be regenerated and installed when runtime source changes; an integrity check compares packaged runtime files to their catalog source. A reviewed release first applies the POS migration, deploys the backend with an approved frontend CORS origin and the flag enabled, then verifies the configured frontend. Disabling the flag hides workspace routes without removing tables or affecting existing POS routes. It does not undo receipts. No staging or production changes are implied by local implementation or package creation.
