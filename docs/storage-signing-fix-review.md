# Saved photo upload correction

Saved phone uploads fail at `POST /api/catalog/items` with HTTP 500 because the storage provider rejects their signed request with `AccessDenied` / HTTP 400. The failure was still present at 04:28 UTC on 10 September 2026.

The deployed-runtime probe reproduced the rejection with metadata key `catalog_item_id` in both SDK checksum modes. The otherwise identical request succeeded with `catalog-item-id`. This isolates the underscored metadata header as the trigger; it does not establish which intermediary rejects or alters that header.

The prepared release changes this metadata key in `catalogImageStorageService` and `catalogPhotoHandoffService`. Object keys, original files, SHA-256 verification, conditional writes, stock receipt, and saved upload IDs remain unchanged. No migration is required. Existing metadata is not used to identify items during resume, so previously saved images remain compatible.

Validation ran the patched service sources in memory inside the deployed server. It verified fresh upload, byte-for-byte download, a second upload preserving the existing object, photo handoff and hash verification, repeated handoff producing one gallery insertion, and reading an existing production image. Database calls in the handoff test were substituted with an isolated fake; no live catalog or stock records were created. See `verification/hosted-storage-fix-test.json`.

Release snapshot: `.test-data/storage-signing-pos`, copied from the currently deployed `.test-data/background-ai-pos` snapshot. Reproducible patch: `server/host-integration/apply-storage-metadata.cjs`. Only the two storage services differ. Package versions and lockfile are unchanged.

Owner-approved deployment `26e4551f-944a-4123-b257-459f5f2dfb38` completed successfully on 10 September 2026. Public application and database health checks both returned HTTP 200. Target: Inventory_POS production service `16a1ac8a-2114-4107-8066-26fb699c1641`, project `f06ae302-c116-487a-96d6-4a76a387e533`, environment `87667cac-e089-45e8-b67d-2c5d0d25b9a8`. Previous deployment: `b0be3f0f-0c72-4478-b75d-f5775675f707`. After deployment, verify health and ask the owner to Resume on the same phone; confirm successful upload and batch-link responses. The phone's eight saved uploads have not yet been recovered.

Temporary SSH access used for diagnostics was revoked and its local private keys removed. Diagnostic image objects are candidates for later removal: `diagnostics/storage-signing-20260910*`, `diagnostics/catalog-upload-fix-20260910.png`, and the test-only copy under `pos-products/catalog/df20858a-14eb-4bea-aa75-e9e1021eb789/`. They have no catalog or POS records.
