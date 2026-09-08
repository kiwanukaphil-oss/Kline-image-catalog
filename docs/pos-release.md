# Packaged POS integration

Released 8 September 2026: package 0.17.0 scopes current stock and filter choices to branch assortment membership. Production migration 109 passed with a fresh verified dump and unchanged stock balances. POS `d11e1d5` is deployed on Railway and Cloudflare Pages; Catalog runtime source is `1cb235a`. See `verification/production-branch-release.json`.

The initial package 0.16.0 release came through [POS PR #1](https://github.com/kiwanukaphil-oss/Inventory_POS/pull/1), merged as `6038486` on 7 September 2026. Migrations 106 through 108 passed the canonical production backup guard. See [production continuity and remaining acceptance](production-cutover-plan.md).

## Runtime artifact

The catalog's `server/` directory owns `@kline/pos-workspace@0.17.0`, including stock discovery, AI review and independent photo recovery. `npm pack` produces `kline-pos-workspace-0.17.0.tgz`. POS stores the tarball in `backend/vendor/` and its package-lock pins the file dependency and integrity. No registry or adjacent catalog checkout is needed at runtime. The installed package contains five runtime modules, its manifest and README; it has no test image store, database credentials or automatic migration code. Earlier tarballs are retained as removal candidates pending review.

After changing runtime source, increment the package version, pack it into the POS vendor directory, install that exact file dependency, then verify it:

```powershell
$env:POS_BACKEND_PATH = 'C:\Projects\inventory-pos-system\backend'
node server/tests/verify-installed-package.cjs
```

Older tarballs are removal candidates once a newer release is reviewed. Keep the currently locked artifact until then.

## Server and schema

The normal POS server mounts `/api/catalog-workspace` when `CATALOG_WORKSPACE_ENABLED=true`. Its default is disabled. It uses the existing Helmet, exact CORS origin allowlist, body sanitizer, JWT, permissions and branch checks. Missing package or publication-contract failures stop startup when enabled.

POS migration `106_catalog_workspace_receiving.sql` adds delivery groups and memberships. It changes no stock or commercial data. The regular POS migration manifest and startup preflight track it. The old catalog migration `001_receiving_batches.sql` remains as a local fixture reference; production runs migrations 106 (deliveries), 107 (photo tasks), and 108 (reversible cancellation).

The preview now uses this normal POS app and installed package. Its local-only guard and filesystem image fixture still confine it to the dedicated local test database. Production uses the POS private Railway storage implementation.

## Release sequence after review

1. Include the reviewed POS integration, migration and locked tarball in the deployment artifact. Use Node 22.13 or newer and install dependencies with `npm ci`.
2. In the chosen staging environment, inspect `npm run migrate:status`, then apply the reviewed migration with `npm run migrate`. Check that no migration or checksum mismatch remains. Follow the existing POS backup/release procedure before any production migration.
3. Add the exact staging frontend origin to `CORS_ORIGINS` and enable `CATALOG_WORKSPACE_ENABLED=true`. Keep the existing JWT, branch and private-bucket configuration; no browser secrets are added.
4. Build the frontend with `NEXT_PUBLIC_POS_API_URL` pointing to that POS `/api` origin and `NEXT_PUBLIC_POS_URL` pointing to the POS UI. Use the actual approved frontend origin, not localhost.
5. With staging identities, verify login, branch restrictions, private image upload/read, delivery/count edits, group price and exception review, receiving, safe retry and current POS availability. Verify a disallowed origin receives no CORS access. Live AI extraction and cross-app navigation need their own staging checks.
6. Promote only after staging review. Disabling the flag hides workspace routes while preserving delivery records and receipts. It does not reverse received stock; stock corrections continue through the POS's audited workflow.

Actual staging identity, CORS, both frontends, original private photos and POS navigation now pass on the isolated Railway deployment. See `railway-staging.md` and `verification/railway/`. Provider AI passes in staging; physical-device/staff acceptance and the final production catalog sign-in/upload check remain open.
