# K-Line completion checklist

Updated: 6 September 2026. This is our working source of truth. Update it after each step; retain historical design documents as history.

**Checked means implemented and verified locally unless explicitly labelled staging/production.** An implemented feature can still await commit, release or staff acceptance. Optional features do not silently become launch requirements.

**Release candidate: package 0.16.0. Core workflows and administration are implemented. 249 clean committed POS backend tests, 22 POS frontend tests, 24 workspace checks and eight accessibility views pass; audits report zero known vulnerabilities. All 21 browser cases pass, including the targeted two-app repeat after preview restart. Local backup/restore and all 108 migration checks pass. The isolated Railway deployment, real private bucket and cross-app acceptance pass. Live AI integration passes on two real photos; broader staff accuracy, physical devices and production release remain pending.**

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
- [x] T8 249 clean committed backend tests/26 suites, 22 POS frontend tests/5 suites, 24 workspace checks, zero dependency advisories, eight clean accessibility scans and 1,000-lot benchmark pass. All 21 browser cases pass after targeted navigation and missing-size restock repeats. See `verification/release-validation.json`.
- [x] T9 Local consistent backup restored into a new database: 13 table counts match; original/restored ledgers both have 108 migrations and no pending/checksum issues. Disabled-mount rollback and image recovery pass existing integration tests. Production backup, object storage, monitoring and rollback acceptance remain G5/G7/G8. See `docs/operations.md`.

## G. Source control and release

- [x] G1 Reviewed app committed as `65a4f07`; POS safeguard as `6de2d74`; unrelated POS AI edits excluded.
- [x] G2 Packaged integration committed as catalog `3f0af21` and POS `1cc61ba`; subsequent verified slices committed under the user's continuing authorization. Unrelated POS AI edits remain separate.
- [x] G3 Catalog main pushed to the provided repository. POS changes pushed on `catalog/workspace-release`; draft [Inventory_POS PR #1](https://github.com/kiwanukaphil-oss/Inventory_POS/pull/1) awaits staging/acceptance. Production master remains unchanged.
- [x] G4 New private Railway project `kline-catalog-staging`, separate PostgreSQL volume/bucket, secure staging identity, branch and exact frontend origins configured. See `docs/railway-staging.md`.
- [x] G5 Both frontends and POS API healthy on Railway; all 108 migrations current; actual CORS, login, private byte-preserving images, pricing, partial receipts, stock and POS navigation pass. Live AI integration now passes (R11d); broader staff quality acceptance remains R11e. Evidence: `verification/railway/`.
- [ ] G6 Owner/staff acceptance of required checklist items on staging.
- [ ] G7 Approve production backup/migration/deployment, release, then verify production behavior.
- [ ] G8 Monitoring/rollback confirmation, staff handover and closure of launch issues.

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
