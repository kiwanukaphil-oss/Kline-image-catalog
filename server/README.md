# K-Line POS workspace runtime

Private runtime package for the K-Line receiving, pricing preparation and current-stock workspace. The host POS owns authentication, branch authorization, pricing, stock transactions and private image storage.

`createPosWorkspaceRouter(backendPath)` returns an Express router using that POS installation. Mount at `/api/catalog-workspace` after the POS security middleware and before its 404 handler. Requires the pinned receiving publication contract (ADR-073) and POS migration 106. The POS mount is controlled by `CATALOG_WORKSPACE_ENABLED=true`; its default is disabled.

Only five runtime modules and package documentation ship. Test hosts, local image fixtures, credentials, migrations and development assets are excluded. The POS migration runner owns production schema changes; this package never migrates a database during startup.

Release preparation: run `npm pack` here, install the resulting versioned tarball from the POS backend's `vendor` directory, and commit its package-lock update with the reviewed POS integration. Verify package contents and source integrity before staging. No registry publication is required.
