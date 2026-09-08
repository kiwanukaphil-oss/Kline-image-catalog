# K-Line completion checklist

Updated: 8 September 2026. This is our working source of truth. Update it after each step; retain historical design documents as history.

**Checked means implemented and verified locally unless explicitly labelled staging/production.** An implemented feature can still await commit, release or staff acceptance. Optional features do not silently become launch requirements.

**Production deployed: workspace 0.16.0 and POS 6038486. Real sign-in, existing photos, both branches, current stock, POS links and upload/reload/resume/cancellation pass. One labelled test intake is cancelled; all 1,031 original items, 263 receipts and POS commerce records remain unchanged. Category decisions, monitoring ownership and physical-device/staff acceptance remain open. See the [production cutover checklist](docs/production-cutover-plan.md).**

## U. Unit totals and test delivery cleanup

- [x] U1 Remove the owner-identified cancelled production verification delivery; preserve its intake/photo audit evidence and stock.
- [x] U2 Count units across the complete filtered lot result, per delivery and in pricing/selection counters.
- [x] U3 Verify filtered/paginated totals, catalog-read tests, typecheck, lint and build.
- [x] U4 Owner approved; POS `4ad4cae` and Catalog `c2e33cc` committed, pushed and deployed. Live Ntinda 964 lots / 965 units, Namugongo 67 / 118, filtered HUGO 6 / 36 and pricing 63 / 104 verified. CI and eight health checks pass.

## B. Branch assortment ? approved 8 September 2026

- [x] B1 Separate branch membership from quantity; backfill stock history without changing balances.
- [x] B2 Exclude never-received products from POS browsing, searches, scans and alerts; preserve depleted sizes.
- [x] B3 Implement branch-only retirement at zero, with audit; receiving and transfers restore membership.
- [x] B4 Scope image app Stock and its filters; runtime package 0.17.0 matches installed source.
- [x] B5 Preserve permission-checked first-time receiving discovery by name and SKU.
- [x] B6 Implement persistent branch identity, reload preservation, scoped counts and stock-unit totals.
- [x] B7 Authenticated local browser verification: desktop/mobile branch switching, reload, first receipt by name, depletion, retirement, re-receipt by SKU and receipt/transfer form isolation. User-started preview resolved the launch blocker. Evidence: `verification/branch-assortment-local.json`.
- [x] B8 Owner authorized commit/deployment. POS `d11e1d5` and Catalog runtime source `1cb235a` committed and pushed.
- [x] B9 Fresh production dump verified; canonical migration 109 passed with backup guard enabled and identical stock fingerprints. Railway API and Cloudflare POS frontend released. Live Namugongo Products and Catalog Stock are empty; Ntinda retains 270 units / 241 SKUs / 213 products. Evidence: `verification/production-branch-migration.json` and `verification/production-branch-release.json`.

## A. Purpose and design

- [x] A1 Study original workflows and POS contracts; agree on preparing new stock plus monitoring current stock.
- [x] A2 Implement Receiving, Pricing and Stock as distinct destinations; reduce overlapping navigation and instructional banners.
- [x] A3 Responsive desktop/mobile navigation, restrained theme and dark appearance.
- [x] A4 Preserve earlier designs and flag removal candidates.
- [ ] A5 Staff usability sessions without coaching: record confusion, completion times and errors, then refine.
- [x] A6 Local keyboard/focus restoration and mobile sizing verified; axe reports zero violations across eight light/dark/mobile views. Fixed faint inactive tabs, photo-placeholder contrast and unnamed-image alt text. See `verification/accessibility.json`; physical-device/staff checks remain A5/R12.

## R. Receiving

- [x] R1 Persistent branch-scoped deliveries and memberships; earlier items remain accessible without invented provenance.
- [x] R2 Multiple-photo intake, stable IDs, safe retries and reload recovery, isolated by account/branch.
- [x] R3 Category-defined detail editing with validation, audit and stale-edit protection.
- [x] R4 Explicit size quantities; duplicate-size checks; draft stock excluded from sellable stock.
- [x] R5 Server-derived readiness and next tasks; preserve delivery context through Pricing.
- [x] R6 Exact receipt review, actor/branch revision, atomic per-lot publication and safe concurrent retries.
- [x] R7 Partial receipt recovery and fresh review after competing edits; received details/counts protected.
- [x] R8 Historical receipts remain unchanged after a POS sale changes availability.
- [x] R9 Complete receipt/delivery history search and pagination beyond the former 200-receipt limit. All 205 test receipts traversed exactly once; receipt-ID search, desktop/mobile navigation and clear-search verified in package 0.6.0.
- [x] R10 Full photo/label inspection with zoom, fit, unavailable-image reload and preservation of unsaved details. An audited photo/label hold blocks receiving until explicit resolution. Package 0.7.0; 12 POS tests and desktop/mobile recovery verified.
- [x] R11a Select individual or multiple photographed lots and explicitly run AI fill; show progress and per-lot results, stop after the current photo and resume remaining work.
- [x] R11b Review uncertain suggestions with evidence beside editable fields; correct/confirm details and separately confirm physical quantities. Review is revision-checked and audited; original observations remain historical.
- [x] R11c Protect existing/unsaved edits, check persisted job outcomes after failures and reconcile a lost response without automatically repeating a paid request. Verified with real POS/PostgreSQL and a deterministic provider boundary.
- [x] R11d Actual staging AI extraction succeeds on two private photos, preserves staff names/brands/colours, retains label evidence and low-confidence inference, leaves quantities unconfirmed and reopens saved results without new paid requests. See `verification/railway/ai-provider.json`. Abandoned-job recovery remains verified in package 0.15.0.
- [ ] R11e Broader confidence/accuracy assessment with staff on their own merchandise photos; part of G6 acceptance.
- [ ] R12 Physical-device capture/install/share acceptance remains. Actual Railway share/offline/reconnection and private-cache exclusion pass; real 401 recovery preserves unsaved input and branch through same-account login, and navigation guards retain/discard unsaved pricing explicitly. See `verification/session-navigation.json` and `verification/pwa-share.json`.
- [x] R13 Camera/burst intake, native fallback, large-image preparation, non-destructive duplicate warnings and install/share/offline/update support implemented. Six capture/queue and seven actual service-worker checks pass. See `docs/phone-intake.md`; physical phone quality and OS integration remain R12/G5.
- [x] R14 Task/category filters and useful ordering run before pagination, preserving branch/delivery context and recoverable empty states. Package 0.12.0; 18 focused POS tests and mobile browser verification. See `verification/receiving-filters.json`.
- [x] R15 Item activity shows actor/time, source and recorded changes, with full pagination and preservation of unsaved edits. Package 0.13.0; 19 focused tests include nested cost protection and branch scope. See `verification/item-activity.json`.
- [x] R16 Reversible, audited cancellation for accidental intake and saved phone queues. Preserve evidence/membership; durable cancelled IDs block delayed uploads; received/POS-linked stock protected. Package 0.14.0; 41 focused POS tests and mobile cancellation/restore/queue verification. See `docs/intake-cancellation.md`.

## P. Pricing

- [x] P1 Select merchandise → shared price → optional exceptions → review → save.
- [x] P2 Category/brand/size filters, word search and selection across result pages.
- [x] P3 Brand/size group exceptions and individual overrides; conflicting matches require resolution.
- [x] P4 Partial-size edits preserve sibling prices and parent defaults.
- [x] P5 Separate fill/revise intent; protect existing inherited prices.
- [x] P6 Separate permission-controlled costs; cost-only updates preserve retail; unauthorized users receive no costs.
- [x] P7 Authoritative grouped/exact review, stale-plan rejection, idempotent apply and conditional Undo.
- [x] P8 Both requested Hugo Boss/XL and shorts/H&M examples verified against real POS services.
- [x] P9 Matching/proposal compilation exercised for 1,000 lots / 3,000 size lines.
- [x] P10 Durable pricing History with actor/date, exact changes and authorized Undo after reload. Existing account/branch and cost boundaries retained; 27 focused POS tests and mobile reload/Undo verified in package 0.8.0.
- [x] P11 Both requested examples now pass actual Railway save and Undo at 1,000 lots / 3,000 sizes each. Every persisted price and restoration checked in PostgreSQL; stock remains unreceived. Bounded parallel reads reduced complete pricing load with 2,000 drafts from 12.6s to 6.0s in the comparison run. Synthetic lots reuse a photo; unique-photo/concurrent-user throughput remains distinct. See `verification/railway/large-delivery.json`, `shorts-scale-before.json` and `shorts-scale.json`.
- [ ] P12 Staff can complete both examples and resolve conflicts without procedural instructions.

## S. Current stock

- [x] S0 Current POS products/prices/branch balances, including POS-only merchandise, without multiplying stock by photos.
- [x] S1 Category and exact-brand filters; barcode search alongside name/brand/SKU; combine with size and stock state. Empty results retain choices and offer Clear filters. Verified in the packaged POS API and desktop/360px browser; see `verification/stock-discovery.json`.
- [x] S2 Size-level low/out-of-stock/discrepancy views, configured thresholds and signed negative balances.
- [x] S3 Movement details, refresh/timestamps and retention of failed-refresh snapshots.
- [x] S4 Real POS sale changes availability while received quantities stay historical.
- [x] S5 Verified real adjustment, sale/return and dispatched/received transfer endpoints against current-stock UI, including destination-branch mobile movement history. See `verification/stock-flows.json`.
- [x] S6 Supported links into authorized POS product/price/stock actions with correct context and expired-session handling. Real two-app browser verification passes; six redirect-safety tests and both TypeScript checks pass. Evidence: `verification/pos-navigation.json`.

## I. Remaining POS handoffs

- [x] I1 Durable catalog-photo handoff into POS product imagery; preserve originals and store object keys, never signed URLs. Migration 107 and package 0.5.0; local byte-preserving bucket fixture, live bucket acceptance remains G5.
- [x] I2 Visible image status/retry independent of receipt; protect manual images and prevent duplicate stock after failure. 29 focused POS tests and desktop/mobile recovery verified.
- [x] I3 Explicit existing-product restock: choose product, match each size, review destination SKUs/prices and confirm. Package 0.10.0; actual desktop/mobile receipt verified, no implicit merging. See `verification/restock.json`.
- [x] I4 Restock policy keeps POS prices/costs; six focused tests cover stale prices/quantities/actor, invalid matches, branch isolation, intervening stock movements, atomic audit and concurrent retry. Real two-app journey creates XL with zero opening stock, refreshes matching choices and receives exactly three units. See `verification/restock-missing-size.json`; staging/staff acceptance remains G5/G6.
- [x] I5 Reachable, permission-controlled category mappings from settings and blocked receiving items. Package 0.9.0; audited, stale-protected saves, 15 focused POS tests, 24 workspace checks and desktop/mobile verification. See `verification/category-mappings.json`.
- [x] I6 Actual Railway HTTPS cross-app pricing/stock links preserve branch and destination through separate/expired login; unauthorized branch denied, no credentials in URLs. See `verification/railway/handoff.json`.

## D. Administration and parity

- [x] D1 Inventory original capabilities from the active Railway import graph, distinguish masked legacy controls and historical CSV claims, and track outstanding parity explicitly. See `docs/original-capability-inventory.md`; no removal approved.
- [x] D2 Separate settings provides audited, revision-checked category/inherited-field authoring, mappings, authorized POS users/permissions and branch diagnostics. Existing field keys/types and ancestry preserved. Package 0.16.0; 23 focused tests and mobile category/inheritance/navigation checks pass.
- [x] D3 Older-style imports, ungrouped records, flags, incomplete counts and historical POS links verified. Package 0.11.0 consistently locks older links and rejects duplicate receiving on incomplete sync state. See `docs/older-data-compatibility.md` and `verification/older-data.json`; production data audit remains release work.
- [ ] D4 Approve and perform removal of superseded code/components only after parity review.

## T. Integration and verification

- [x] T1 Reuse POS identity, permission, branch and commerce services; real PostgreSQL tests, no second stock ledger.
- [x] T2 Package the workspace into the normal POS server, with an enable flag and existing security middleware.
- [x] T3 POS migration 106 registered; fresh database migration and existing-preview preflight verified.
- [x] T4 Installed package matches source; clean locked install succeeds; test hosts/fixtures excluded.
- [x] T5 Baseline: 224 POS tests/24 suites, 24 workspace checks, four pricing-example checks, nine browser checks. See `verification/packaged-workspace.json`.
- [x] T6 Passing recorded TypeScript, lint/build, syntax and Railway source checks.
- [x] T7 Feature tests and package verification extended through 0.16.0; all seven installed files match source.
- [x] T8 261 clean committed backend tests/27 suites (including 12 client-IP/auth-limit checks at POS dbde269), 22 POS frontend tests/5 suites, 24 workspace checks, zero dependency advisories, eight clean accessibility scans and 1,000-lot benchmark pass. All 21 browser cases pass after targeted navigation and missing-size restock repeats. See `verification/release-validation.json`.
- [x] T9 Local consistent backup restored into a new database: 13 table counts match; original/restored ledgers both have 108 migrations and no pending/checksum issues. Disabled-mount rollback and image recovery pass existing integration tests. Production backup, object storage, monitoring and rollback acceptance remain G5/G7/G8. See `docs/operations.md`.

## G. Source control and release

- [x] G1 Reviewed app committed as `65a4f07`; POS safeguard as `6de2d74`; unrelated POS AI edits excluded.
- [x] G2 Packaged integration committed as catalog `3f0af21` and POS `1cc61ba`; subsequent verified slices committed under the user's continuing authorization. Unrelated POS AI edits remain separate.
- [x] G3 Catalog main pushed to the provided repository. POS changes pushed on `catalog/workspace-release`; [Inventory_POS PR #1](https://github.com/kiwanukaphil-oss/Inventory_POS/pull/1) merged as `6038486` under the owner?s production replacement request on 7 September 2026.
- [x] G4 New private Railway project `kline-catalog-staging`, separate PostgreSQL volume/bucket, secure staging identity, branch and exact frontend origins configured. See `docs/railway-staging.md`.
- [x] G5 Both frontends and POS API healthy on Railway; all 108 migrations current; actual CORS, login, private byte-preserving images, pricing, partial receipts, stock and POS navigation pass. Live AI integration now passes (R11d); broader staff quality acceptance remains R11e. Evidence: `verification/railway/`.
- [ ] G6 Owner/staff acceptance of required checklist items on staging.
- [x] G7 Production backup, recovery rehearsal, canonical migrations and deployment complete. Actual private upload, restart recovery, exact-one intake, cancellation and preserved existing records verified. Both websites and eight public health probes pass. See [production cutover](docs/production-cutover-plan.md).
- [ ] G8 Monitoring ownership/scheduling, staff handover and remaining launch decisions. Production backup/object recovery and rollback targets are recorded; manual GitHub health probes pass. Existing proxy/auth safeguards are live. Approved category creation and mappings are complete. Physical-device/staff acceptance remains open.

## O. Optional scope — decide explicitly

- [ ] O1 Reusable price lists/templates applied as reviewed drafts, not automatic continuous repricing.
- [ ] O2 Additional label/detail/evidence photos attached to one lot rather than counted as extra stock.
- [ ] O3 Supplier/reference details and role-based landing/resume preferences.
- [ ] O4 All-branch stock breakdown and deeper movement-history navigation.
- [ ] O5 Native WebMCP verification when supported; ordinary UI does not depend on it.

## Completion and update rules

Complete required A–G tasks, decide O items explicitly and obtain owner acceptance. Local implementation is not deployment; logic tests are not load tests; screenshots are not staff usability acceptance. Before a step, name the active item. After it, update status, evidence, limitations and next item. Keep commit/push/deployment gates explicit.

| Date | Update | Next / evidence |
|---|---|---|
| 2026-09-06 | Baseline created from approved design, code and verification. | S1 started immediately; I1 follows. |
| 2026-09-06 | S1 completed and verified; package rebuilt/installed as 0.3.0. | Nine focused POS tests, three browser checks, 24 workspace checks, build/lint/TypeScript/format pass. Next: I1. |
| 2026-09-06 | User prioritized the explicit AI fill workflow; R11a–c implemented in package 0.4.0. | 21 focused POS tests, four AI browser checks and 24 workspace checks. Evidence: `verification/ai-fill.json`. Real-provider R11d remains open; next I1. |

| 2026-09-06 | R13?R16, administration, session recovery and local accessibility/operations completed through package 0.16.0; source pushed and POS draft PR opened. | Final POS preview repeat awaits restart; staging target remains undecided. Clean committed-tree verification passed: 249 tests/26 suites at POS 402133c. |

| 2026-09-06 | T8 completed: cross-app navigation and missing-size restock pass after owner restart. New private Railway project `kline-catalog-staging` created with separate PostgreSQL and image bucket. | G4/G5 in progress: Node runtime and staging services. |

| 2026-09-06 | G4/G5 and I6 completed in the new Railway project: live receiving, private original photos, exact eight-unit stock and cross-app session/branch checks pass. | R11d needs staging AI key; G6/A5/P12/R12 require owner/staff and physical devices. Production gates remain open. |

| 2026-09-06 | R11d complete: owner supplied staging key, AI enabled, two real photo runs succeed, preserved edits and saved-result recovery verified. Railway unsigned-header upload failure resolved with SDK checksum compatibility setting; existing private-photo/POS checks still pass. | R11e/A5/P12/G6 and physical-device R12 require owner/staff acceptance. Production gates remain open. |

| 2026-09-06 | Both pricing examples verified on Railway at 1,000 lots / 3,000 sizes each, including exact saved prices and mobile Undo. Added bounded parallel pricing reads (12.6s to 6.0s observed with 2,000 drafts). Real staging PWA share/offline/cache checks pass. | Synthetic unpriced deliveries are ready for staff acceptance; physical device and owner/production gates remain open. |

| 2026-09-06 | G8 preparation: eight read-only live health probes pass on repeat; first-run POS connection failure retained with exit code 1, passing repeat returns 0. Added monitoring/rollback procedure and tracked the proxy/login-limiter launch issue. | Committed and pushed as ca48eb6. Scheduled monitoring, named ownership, proxy verification and G6/G7 acceptance remain pending. See `verification/railway/health.json`, `health-first-run.json` and `docs/monitoring-and-rollback.md`. |

| 2026-09-06 | G8 technical follow-up complete: POS dbde269 uses validated Railway client identity for IP limits and audits; session reads no longer spend the login allowance. All 261 backend tests / 27 suites and actual Railway header-spoof/session checks pass. | Owner/staff acceptance, physical phones, monitoring ownership and production rollout approval remain required. Evidence: `verification/railway/auth-proxy.json`; no production changes. |

| 2026-09-07 | Owner requested the production replacement. Audited 1,031 existing catalog items and reused their live POS database/bucket. Restored all 81 tables, backed up all 1,237 images and verified object recovery. Two historical-data UI fixes deployed; POS release merged and migrations applied. | C5 category/access decisions and C8 authenticated live verification remain; preserve old browser queues and rollback origin. |

Production browser update, 7 September 2026: owner sign-in passes; 964 NTINDA and 67 NAMUGONGO lots are visible. An original private photo decodes at 960 x 1280. Current stock, movement history and the correct live POS product/branch/pricing destination pass. Upload verification is blocked before submission by Chrome extension file-URL access (fileChooser.setFiles: Not allowed). No test delivery or stock was created. See `verification/production-browser.json`.

| 2026-09-07 | C8/G7 complete: production upload error resolved by fresh checksum-configured API deployment. Same saved photo survived reload, resumed once, matched original bytes and was cancelled without POS receipt. Original catalog and commerce hashes remain unchanged. | Category mapping decisions, staff/device acceptance and monitoring ownership remain. |

| 2026-09-07 | C5a complete: created active Jeans and Sweat pants under active POS Pants; connected both and existing Shorts through the administrator UI. All 25 active catalog categories are connected. | Staff access, physical-device acceptance and monitoring ownership remain open. |

| 2026-09-07 | C9a complete: klinemen-catalog.com moved from GitHub Pages to Railway; domain ownership, certificate, new app HTML, service worker and www redirect verified. Eight public health probes pass. | Cached-browser/device handover and additional staff/monitoring decisions remain. DNS rollback records and old deployment are preserved. |

| 2026-09-08 | Fixed POS Products table leaking Ntinda quantities into Namugongo: pricing variants feed now authorizes and reads the selected branch. 263 backend tests, TypeScript and eight live probes pass. | Live API deployment 7c5270a9-346d-412e-9caa-7306e707c26e; browser confirms Namugongo rows are zero, Ntinda unchanged. Owner-approved fix committed and pushed to POS master as 665f83d. |


## Receiving workflow follow-up - 8 September 2026

- [x] Dedicated Preparation and Ready for POS queues, with authoritative blockers and lot/unit totals.
- [x] Receive all ready or selected lots; page selection and all matching selection persist across pagination. Category, brand, delivery and search narrow the scope.
- [x] Direct receiving action from a ready lot; one grouped confirmation shows destination branch, lots and units, with expandable size/pricing details.
- [x] Revalidate selected lots before confirmation; exclude blocked/cancelled lots, retain stable publication IDs and signed revisions, and retry only unresolved lots.
- [x] Completion summary links to current stock and historical receipts.
- [x] Local browser regression: 1,000 ready lots, selection across pages, brand filtering, direct receipt, changed-count exclusion, partial failure/retry, changed-price re-review, stock navigation, preparation queue and mobile bounds. All receipt writes intercepted; no live stock changed. Test: `app/tests/bulk-receiving.mjs`.
- [x] Existing picker/branch checks, TypeScript, lint and production build pass. Desktop/mobile screenshots reviewed under ignored `.test-data/bulk-receiving/`.
- [x] Owner-approved workflow committed and pushed as `a2e7e8c`; Railway deployment `699139f8-f37f-4fa8-a112-8d424e9a0838` succeeded on 8 September 2026. Live Ready for POS and bulk confirmation verified for NAMUGONGO: 67 lots / 126 units. Closed review without receiving stock; all eight public production health checks passed.

Implementation note: selection reads the complete filtered set through existing permission-scoped API pages with at most four concurrent reads. Confirmation also bounds detail reads to four; receiving retains sequential per-lot POS transactions. The 1,000-lot browser test validates behavior with intercepted responses, not production load capacity.

## Product identity and Namugongo matching - 8 September 2026

- [x] Inspect all 67 original photos and saved size quantities; identify 12 supported model groups covering 41 lots. Keep 26 lots separate where designs differ or model evidence is insufficient. Proposed result: 38 products / 126 units.
- [x] Record each matching decision, model, source IDs, photo hashes and timestamps in `docs/namugongo-product-matching-review.md` and `verification/namugongo-product-matches.json`. Validate no omitted/overlapping lots and no conflicting prices or costs for combined sizes.
- [x] Add explicit product matching from selected ready lots, retaining original evidence and an audited option to return lots to separate products.
- [x] Support one new product, additional variants on an existing product, and stock added to existing variants. Normalize size aliases; block incomplete native attribute matches instead of creating accidental duplicate variants.
- [x] Revalidate all members and target variants at receipt; commit each matched group atomically through native POS stock services. Prevent individual receipt bypass and duplicate stock on concurrent retries.
- [x] Preserve every source photo in the shared product gallery, keeping the first/manual primary image and retrying photo transfer independently of stock.
- [x] Local grouped-receipt tests pass for size reuse/new sizes, exact quantities, prices, permissions, stale reviews, overlapping membership, rollback and photo preservation. All 25 existing native publication/restock/photo tests pass.
- [x] Browser checks pass for saving an evidence-backed group and receiving it once through bulk confirmation; existing 1,000-lot receiving regression, TypeScript, lint and production build pass.
- [x] Owner confirmed commit and deployment. Catalog release `7d8f8cf` and POS release `aa94caa` are committed and pushed.
- [x] Applied migration 110 after a fresh readable PostgreSQL 18 backup; POS deployment `0e7009b3-e17d-4e97-a5ba-5f9843f1d7f2` and catalog deployment `bcbe5d53-8b41-420e-a2b7-1a49424ce258` succeeded. Live matching saves and all eight public health probes pass. Two initial deploy attempts were stopped before the required backup/migration step.
- [x] Revalidated unchanged source timestamps and saved all 12 reviewed matches through the authenticated Namugongo workspace. Read-only database comparison confirms exact memberships: 41 grouped lots + 26 separate lots = 38 proposed products / 126 units. Zero POS publications and zero Namugongo stock. Evidence: `verification/product-matching-live.json`. The live full receipt preview confirms 126 units / 67 lots and 12 matched + 26 separate products, with no excluded blockers. Closed without submitting. Preview: `verification/product-matching-live-preview.json`. Receiving remains a separate owner action.

Local verification note: C: ran out of space during the first native regression run. Generated `.test-data` artifacts were preserved on D: and linked at their original path. The subsequent 25-test run and build passed. No source files or original inventory images were deleted.

## Structured sleeve length - 8 September 2026

- [x] Confirm the actual gap: Shirts already has an optional inherited `sleeve` field, but native catalog publication omitted it from POS variant attributes. Namugongo currently has 54 lots marked Long and 13 unset.
- [x] Carry the existing sleeve value through normal publication and matched receiving; retain line-level sleeve overrides. Matching distinguishes Short from Long and recognizes common sleeve wording aliases.
- [x] Prepare migration 111: label the existing field Sleeve length, preserve custom choices and stored values, add Three-quarter/Sleeveless and AI vocabulary aliases, and provide the inherited field for jackets. Gender remains optional.
- [x] Include sleeve in the photo evidence shown while matching. AI extraction uses the configured field and stores its value, confidence and evidence independently of the item name.
- [x] Verify 24 native tests (sleeve, publication and restock), real local grouped receiving including Long-XL restock versus a separate Short-XL variant, TypeScript, lint and production build. Repeat the final migration/AI tests after checking the live schema: 3/3 pass.
- [ ] Owner confirmation to commit/deploy the sleeve release (workspace 0.20.0 / migration 111), followed by a fresh backup, migration and live verification.

No production sleeve values were changed. Existing Long values are preserved; unset values are not inferred from item names or category. The 12 saved matching plans and all 126 units remain unchanged.
