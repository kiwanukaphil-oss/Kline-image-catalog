# Packaged POS integration

The reviewed initial implementation is committed as catalog `65a4f07` and POS `6de2d74`. The next integration changes package the workspace into the ordinary POS backend. They are prepared locally for review; no push or deployment has occurred.

## Runtime artifact

The catalog's `server/` directory owns `@kline/pos-workspace@0.5.0`, including stock discovery, AI review and independent photo recovery. `npm pack` produces `kline-pos-workspace-0.5.0.tgz`. POS stores the tarball in `backend/vendor/` and its package-lock pins the file dependency and integrity. No registry or adjacent catalog checkout is needed at runtime. The installed package contains five runtime modules, its manifest and README; it has no test image store, database credentials or automatic migration code. The earlier 0.2.0 and 0.3.0 tarballs are retained as a removal candidate pending review.

After changing runtime source, increment the package version, pack it into the POS vendor directory, install that exact file dependency, then verify it:

```powershell
$env:POS_BACKEND_PATH = 'C:\Projects\inventory-pos-system\backend'
node server/tests/verify-installed-package.cjs
```

Older tarballs are removal candidates once a newer release is reviewed. Keep the currently locked artifact until then.

## Server and schema

The normal POS server mounts `/api/catalog-workspace` when `CATALOG_WORKSPACE_ENABLED=true`. Its default is disabled. It uses the existing Helmet, exact CORS origin allowlist, body sanitizer, JWT, permissions and branch checks. Missing package or publication-contract failures stop startup when enabled.

POS migration `106_catalog_workspace_receiving.sql` adds delivery groups and memberships. It changes no stock or commercial data. The regular POS migration manifest and startup preflight track it. The old catalog migration `001_receiving_batches.sql` remains as a local fixture reference; production runs migration 106 and migration 107 for durable photo tasks.

The preview now uses this normal POS app and installed package. Its local-only guard and filesystem image fixture still confine it to the dedicated local test database. Production uses the POS private Railway storage implementation.

## Release sequence after review

1. Include the reviewed POS integration, migration and locked tarball in the deployment artifact. Use Node 22.13 or newer and install dependencies with `npm ci`.
2. In the chosen staging environment, inspect `npm run migrate:status`, then apply the reviewed migration with `npm run migrate`. Check that no migration or checksum mismatch remains. Follow the existing POS backup/release procedure before any production migration.
3. Add the exact staging frontend origin to `CORS_ORIGINS` and enable `CATALOG_WORKSPACE_ENABLED=true`. Keep the existing JWT, branch and private-bucket configuration; no browser secrets are added.
4. Build the frontend with `NEXT_PUBLIC_POS_API_URL` pointing to that POS `/api` origin and `NEXT_PUBLIC_POS_URL` pointing to the POS UI. Use the actual approved frontend origin, not localhost.
5. With staging identities, verify login, branch restrictions, private image upload/read, delivery/count edits, group price and exception review, receiving, safe retry and current POS availability. Verify a disallowed origin receives no CORS access. Live AI extraction and cross-app navigation need their own staging checks.
6. Promote only after staging review. Disabling the flag hides workspace routes while preserving delivery records and receipts. It does not reverse received stock; stock corrections continue through the POS's audited workflow.

Actual staging identity, origins, bucket access and deployment configuration have not been exercised. Those are release-environment checks, not claims made by the local test evidence.
