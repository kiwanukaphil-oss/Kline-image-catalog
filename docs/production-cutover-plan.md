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
| Category mapping | Jeans (208 items), Shorts (15) and Sweat pants (30) lack mappings. Shorts has an active exact POS match. The POS Jeans category is archived; Sweat pants is absent. Owner decision requested before creating or reactivating categories. |
| Staff access | Only active `admin` currently has catalog permissions. Three earlier catalog accounts are inactive. Preserve existing account status and ask which staff should gain access; do not silently reactivate accounts. |
| Phone capture, restart-safe queues, AI review, counts, shared pricing, exception rules, history, cancellation, photo inspection | Implemented and verified. Physical-phone usability remains a human acceptance item, not a reason to describe the software as missing these features. |
| Current stock and POS handoff | POS remains authoritative. Deploy the compatible POS frontend route alongside the backend integration. |
| Old all-branch overview and combined gallery/date/price facets | Replacement separates Receiving, Pricing and per-branch Stock. All-branch aggregation remains a deliberate optional difference, not lost data. |
| Vocabulary suggestions | Vocabulary records are preserved. The current old-app backend already returns an empty vocabulary list; this is not newly removed by the replacement. |
| CSV / masked legacy controls | README claims are not proof of an active deployed feature. No live CSV action was established in the active import graph; retain source and archives. |

## Execution checklist

- [x] C1 Inspect the live source, record counts, identify reference/mapping/access gaps.
- [x] C2 Capture a fresh consistent logical backup; restore into a separate PostgreSQL 18 rehearsal database. All 81 table row fingerprints match. Apply the three migrations there; all pre-existing rows remain unchanged and 108 migrations are current.
- [ ] C3 Back up and hash-verify all 1,237 distinct referenced catalog/POS image objects. Private evidence lives outside Git.
- [x] C4 Validate the two migration-specific interface fixes: focused browser checks, TypeScript, lint and production build pass. Source is included in the production release.
- [ ] C5 Resolve the three category mappings and intended staff access using the owner's decisions.
- [ ] C6 Release the compatible POS backend/frontend, enable the workspace, permit the exact new frontend origin and verify migration status.
- [ ] C7 Deploy the production catalog frontend with the real POS API and POS UI origins. The staging sample database stays isolated.
- [ ] C8 Verify real catalog/stock reads, private photos, login/branch permissions, reviewed upload recovery and no duplicated historic receipts.
- [ ] C9 Confirm the replacement URL, preserve rollback targets and settle old-origin/browser-queue retirement and monitoring ownership.

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
