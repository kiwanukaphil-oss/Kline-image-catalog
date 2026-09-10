# Production replacement and data continuity

Updated 7 September 2026. The owner requested the production replacement, gap
assessment and preservation of the existing app's uploaded images and data.

## Migration approach

The existing `klinemen-catalog.com` app already uses the live POS API at
`https://inventorypos-production.up.railway.app/api`, its PostgreSQL `inventory`
schema, POS accounts and private Railway bucket. Reuse these exact records and
object keys. Do not import a second copy into the test database, regenerate IDs,
re-upload images, or receive already published merchandise again.

The read-only audit found 1,031 catalog items, 1,082 size lines, 621 cost records,
2,973 item events and 263 publication receipts. All item image references and
referenced POS products, variants and branches exist. There are no incomplete
POS links. The 263 already-published items stay received; the other 768 remain
draft/review work. These are existing statuses, not new approvals.

The existing database has migrations 001–105 (105 registered files), with no
checksum drift. Apply only the three reviewed additions: delivery organization,
photo handoff recovery and reversible cancellation. Migration 107 initializes
photo-handoff tasks for linked items; it does not republish stock or replace POS
photos automatically. Existing items remain ungrouped until staff organize new
deliveries. The opening view must reveal existing merchandise immediately.

Local category folders, spreadsheets, retired-provider archives and browser-only
pending uploads are distinct from uploaded server records. Preserve them. Finish
unsent queues in the old app before retiring its origin; a different origin
cannot read another browser's local queue. The old app remains available during
this transition, using the same data, rather than becoming a second stock ledger.

## Current gaps and decisions

| Area | Assessment / action |
|---|---|
| Existing uploaded photos and metadata | Same database and bucket; no bulk import required. Verify counts, stable IDs, private image reads and existing POS links before/after release. |
| First view with old data | Fix the empty-delivery landing: show existing merchandise when no delivery groups exist. Respect subsequent tab choices. |
| Historical field values | Keep saved choices visible; an unrelated name edit must not rewrite or revalidate unchanged historical attributes. |
| Category mapping | Completed with owner approval: new active Jeans and Sweat pants under the active POS Pants category; Shorts connected to its existing active POS category. All 25 active catalog categories show connected destinations. Archived categories were not edited. |
| Staff access | Only active `admin` currently has catalog permissions. Three earlier catalog accounts are inactive. Preserve existing account status and ask which staff should gain access; do not silently reactivate accounts. |
| Phone capture, restart-safe queues, AI review, counts, shared pricing, exception rules, history, cancellation, photo inspection | Implemented and verified. Physical-phone usability remains a human acceptance item, not a reason to describe the software as missing these features. |
| Current stock and POS handoff | POS remains authoritative. Deploy the compatible POS frontend route alongside the backend integration. |
| Old all-branch overview and combined gallery/date/price facets | Replacement separates Receiving, Pricing and per-branch Stock. All-branch aggregation remains a deliberate optional difference, not lost data. |
| Vocabulary suggestions | Vocabulary records are preserved. The current old-app backend already returns an empty vocabulary list; this is not newly removed by the replacement. |
| CSV / masked legacy controls | README claims are not proof of an active deployed feature. No live CSV action was established in the active import graph; retain source and archives. |

## Execution checklist

- [x] C1 Inspect the live source, record counts, identify reference/mapping/access gaps.
- [x] C2 Capture a fresh consistent logical backup; restore into a separate PostgreSQL 18 rehearsal database. All 81 table row fingerprints match. Apply the three migrations there; all pre-existing rows remain unchanged and 108 migrations are current.
- [x] C3 All 1,237 referenced objects (287,614,070 bytes) are backed up and hash-verified. One backup image was restored to the isolated staging bucket and matched byte-for-byte; the rehearsal object was then removed. Private source manifests and bytes stay outside Git; see `verification/production-photo-recovery.json`.
- [x] C4 Validate the two migration-specific interface fixes: focused browser checks, TypeScript, lint and production build pass. Source is included in the production release.
- [x] C5a Create and connect the three approved category destinations; all 25 active catalog categories are connected in the live administrator UI.
- [ ] C5b Confirm any additional staff access. Administrator access works; existing inactive accounts remain unchanged.
- [x] C6 POS backend and frontend released as `6038486`. Railway deployment `e9460629-cd5e-44c7-8be6-794adb78aba2` is healthy; workspace and exact-origin CORS enabled. All 108 migrations are current with zero checksum drift; all 23 catalog/commerce table fingerprints remain unchanged. See `verification/production-continuity.json`.
- [x] C7 Production catalog frontend deployed successfully at commit `6aea4e2`, deployment `0fea13c7-f707-46bf-a9d9-8415b8cc404a`, using the real POS API and UI. Staging stays isolated.
- [x] C8 Real account/branch reads, original private photos, POS stock/movements and price handoff pass. Actual upload survived failure/reload, resumed once, preserved all bytes, reopened after another reload and was cancelled with history retained. One test intake exists under Cancelled intake; all 1,031 pre-existing items, 263 receipts and POS commerce tables remain unchanged. See `verification/production-browser.json`, `production-upload.json` and `production-upload-cancelled.json`.
- [x] C9a Connect the owner-approved production domain, verify HTTPS/new workspace responses and www redirect, and preserve DNS/deployment rollback targets.
- [ ] C9b Complete cached-browser/device handover, old browser-queue retirement and monitoring ownership.

## Targets and rollback

Production catalog project: `kline-catalog-live`
(`7df5ac43-bc99-4cd8-9605-b17fb1cbadfd`), environment
`bfae25a3-032c-415b-a451-4e35da0d85f0`, service
`e848d8df-cf36-4c6b-ab3d-11d7120a4950`.
Prepared URL: https://catalog-production-ed0b.up.railway.app.
Its production API and POS UI are the existing addresses above and
https://inventory-pos.pages.dev. Do not point it at the staging API.

Live POS project: `dynamic-balance` (`f06ae302-c116-487a-96d6-4a76a387e533`).
Pre-cutover API deployment: `2908bd45-2f67-4041-bb51-a6aafc920301`.
Pre-cutover POS source: `2d573e4f831f1515549d9b2cba7f1c59525a9bf3`.
Pre-cutover Cloudflare Pages deployment: `8d060d65-818f-4016-aac8-b09e27be3550`.

Keep additive migrations during application rollback. Disable the workspace
mount or restore the prior compatible deployment if necessary; do not restore an
older database over new sales/receipts. Database disaster recovery is separate.
Private backup locations, object manifests, hashes and rehearsal credentials are
kept in ignored local evidence and the user's migration-evidence directory.

## Release execution

POS PR #1 merged as `6038486` on 7 September 2026. Cloudflare Pages production deployment `929bbed4-0d8c-4f23-882e-a79a8d851434` passed. The first Railway deployment stopped at the production backup gate before applying migrations because the container could not access the local dump. The canonical production runner was then executed from this workstation with the verified dump and its backup guard enabled; only 106-108 applied. See `verification/production-migration.json`. Backend redeployment `e9460629-cd5e-44c7-8be6-794adb78aba2` succeeded; no guard was disabled. The temporary staging database proxy was deleted after rehearsal and its absence verified. The pre-existing production proxy remains unchanged.

All eight public production health checks passed from GitHub runner [34157581100](https://github.com/kiwanukaphil-oss/Kline-image-catalog/actions/runs/34157581100) after the upload fix. See `verification/production-health.json`; earlier local transport-failure samples remain separate. Owner sign-in, both branches, original photos and the full upload/recovery/cancellation check now pass.

## Production upload recovery

The first authenticated upload failed with an unsigned-header storage error. The configured checksum setting was present, but reapplying the same value caused no fresh deployment. A variable-triggered deployment with `AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED` and release marker `CATALOG_RELEASE_REVISION=6038486-storage-20260907` produced successful deployment `5afadc04-6e5d-46a7-b26a-85bbc0575244`. Resuming the original queued photo then succeeded exactly once. This observation establishes the working deployment; it does not claim an inspected value inside the earlier running container.

The 15,431-byte original and stored photo have the same SHA-256. Cancelling the test preserves the private photo and audit history, creates no POS stock, and leaves the original records unchanged. The labeled verification delivery is retained as cancelled evidence. The frontend now labels an all-cancelled delivery Cancelled instead of Preparing.

Read-only category verification passed after transient connection timeouts: all 25 active catalog categories map to active POS destinations, and all 34 original POS categories retain their exact baseline fingerprints, including archived categories. See `verification/production-category-mappings.json`.

## Custom domain transition

Owner authorized moving `klinemen-catalog.com` to the replacement. Cloudflare apex now uses `qi63kp8y.up.railway.app` (DNS only) with Railway ownership TXT. The previous GitHub Pages deployment remains intact and `www` retains its existing 301 to the apex. Original DNS values are recorded in `verification/production-domain-cutover.json`; three old A records are retained under `previous-origin` and marked for review before removal. This is a rollback reference, not a promised working alternate app URL.

Deployment `63267500-2fb9-4ef0-8192-d7f592277cf1` supports the old installed app's `SKIP_WAITING` restart message as well as `ACTIVATE_UPDATE`. Production build and message compatibility checks passed. The old app showed zero intake photos in this browser; other devices were not inspected. No browser databases, queued photos, or cached files were deleted. Domain HTTPS and authenticated browser acceptance are pending below.

Domain activation verified: Railway ownership is verified, DNS propagated, certificate valid, and the apex returns the new `K-Line | Stock workspace` from Railway over HTTPS. Its service worker contains the old-app restart compatibility. The existing `www` endpoint returns 301 to the apex. All eight production health checks pass; the probe now checks the replacement app title to reject cached old HTML. Chrome cached-browser transition and sign-in at this origin remain separately pending; the owner was asked to hard-refresh. See `verification/production-domain-http.json` and `production-health.json`.
