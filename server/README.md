# K-Line POS workspace runtime

Private runtime package for the K-Line receiving, pricing preparation and current-stock workspace. The host POS owns authentication, branch authorization, pricing, stock transactions and private image storage.

`createPosWorkspaceRouter(backendPath)` returns an Express router using that POS installation. Mount at `/api/catalog-workspace` after the POS security middleware and before its 404 handler. Requires the pinned receiving publication contract (ADR-073) and POS migrations through 109 (branch assortment membership). The POS mount is controlled by `CATALOG_WORKSPACE_ENABLED=true`; its default is disabled.

Only five runtime modules and package documentation ship. Test hosts, local image fixtures, credentials, migrations and development assets are excluded. The POS migration runner owns production schema changes; this package never migrates a database during startup.

Release preparation: run `npm pack` here, install the resulting versioned tarball from the POS backend's `vendor` directory, and commit its package-lock update with the reviewed POS integration. Verify package contents and source integrity before staging. No registry publication is required.
# Background AI batches (0.23.0)

Before enabling this package in production, apply `migrations/003_ai_batches.sql` as the next numbered POS migration and apply `host-integration/apply-ai-queue.cjs <backend-directory>` to the reviewed POS source. The integration script validates exact source anchors and installs the shared reservation/fencing guard. Queue submissions fail safely if the host integration is missing. Preserve these host changes in later releases.

The production router starts one worker loop per process. PostgreSQL claims serialize execution across replicas; 2-minute leases with 10-second heartbeats recover interrupted work. The worker stops claiming on SIGTERM/SIGINT. Completed fields and batch-item completion commit together. Uncertain paid attempts require explicit review and retry; queued, unstarted work survives restarts. Existing provider-level retry and usage-cap behavior is retained.

`NODE_ENV=test` disables automatic worker startup; tests explicitly invoke `createAiBatchService(...).runOne()` or `startAiBatchWorker(...)`. Use only the dedicated local database for fixtures.

## Simple delivery checkout

The delivery routes require `node host-integration/apply-delivery-checkout.cjs <backend-directory>` on the POS release source before enabling this runtime. This adds an internal transaction client to the existing publisher, allowing final quantity confirmation and stock receipt to commit or roll back together. The runtime checks this contract at startup. Keep the integration in future host snapshots; no schema migration is needed.

The ordinary journey is Upload ? AI fill ? Price items ? read-only Review ? Send to POS. Pricing and proposed quantities save together in bulk. Existing confirmed groups remain intact; otherwise items become new products without a destination choice. Advanced tools preserve matching, destination overrides, photo-only updates and pricing rules. Permissions, required product details and category setup still apply. Existing POS variants retain their current price, which the final summary displays.

Validation: `server/tests/delivery-checkout.cjs` against the patched local POS host and `app/tests/delivery-checkout.mjs` against the local UI with intercepted API fixtures. Photo-transfer failure is reported separately from committed stock, and repeated sends do not duplicate stock.
