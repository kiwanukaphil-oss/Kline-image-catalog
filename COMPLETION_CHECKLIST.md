# K-Line completion checklist

Updated: 6 September 2026. This is our working source of truth. Update it after each step; retain historical design documents as history.

**Checked means implemented and verified locally unless explicitly labelled staging/production.** An implemented feature can still await commit, release or staff acceptance. Optional features do not silently become launch requirements.

**Latest completed: P10 — durable pricing history with protected Undo after reload. Next: P11 large-delivery benchmark. Live bucket and AI staging acceptance remain open. Autonomous implementation and commits authorized on 6 September.**

## A. Purpose and design

- [x] A1 Study original workflows and POS contracts; agree on preparing new stock plus monitoring current stock.
- [x] A2 Implement Receiving, Pricing and Stock as distinct destinations; reduce overlapping navigation and instructional banners.
- [x] A3 Responsive desktop/mobile navigation, restrained theme and dark appearance.
- [x] A4 Preserve earlier designs and flag removal candidates.
- [ ] A5 Staff usability sessions without coaching: record confusion, completion times and errors, then refine.
- [ ] A6 Final keyboard/focus, contrast, touch-target and mobile accessibility review across the completed app.

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
- [ ] R11d Verify configured AI assistance with the real provider in staging, including confidence quality, staff usability and recovery of jobs left running by a server restart. Deterministic provider fixtures do not complete this acceptance.
- [ ] R12 Real-device capture, offline/reconnection, expired sessions and branch changes during unsaved work.

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
- [ ] P11 Large-delivery browser/database benchmark: load time, requests, selection and pagination. P9 is not this benchmark.
- [ ] P12 Staff can complete both examples and resolve conflicts without procedural instructions.

## S. Current stock

- [x] S0 Current POS products/prices/branch balances, including POS-only merchandise, without multiplying stock by photos.
- [x] S1 Category and exact-brand filters; barcode search alongside name/brand/SKU; combine with size and stock state. Empty results retain choices and offer Clear filters. Verified in the packaged POS API and desktop/360px browser; see `verification/stock-discovery.json`.
- [x] S2 Size-level low/out-of-stock/discrepancy views, configured thresholds and signed negative balances.
- [x] S3 Movement details, refresh/timestamps and retention of failed-refresh snapshots.
- [x] S4 Real POS sale changes availability while received quantities stay historical.
- [ ] S5 Verify real return, transfer and adjustment flows and refresh the correct branch/variant in this UI.
- [ ] S6 Supported links into authorized POS product/price/stock actions with correct context and expired-session handling.

## I. Remaining POS handoffs

- [x] I1 Durable catalog-photo handoff into POS product imagery; preserve originals and store object keys, never signed URLs. Migration 107 and package 0.5.0; local byte-preserving bucket fixture, live bucket acceptance remains G5.
- [x] I2 Visible image status/retry independent of receipt; protect manual images and prevent duplicate stock after failure. 29 focused POS tests and desktop/mobile recovery verified.
- [ ] I3 Explicit receive-against-existing-product workflow with deliberate product/variant matching; no implicit merges.
- [ ] I4 Restock price/cost policy, new/existing sizes, stale matches, branch stock, audit and retry tests.
- [ ] I5 Reachable, permission-controlled category-mapping administration with actionable receiving blockers.
- [ ] I6 Cross-app session/navigation design and staging verification; keep tokens out of URLs.

## D. Administration and parity

- [ ] D1 Inventory every original capability: preserved, redesigned, delegated to POS or explicitly retired.
- [ ] D2 Authorized paths for categories/inherited fields, mappings, users/permissions and diagnostics, away from daily workflows.
- [ ] D3 Existing-data compatibility: older imports, flags, incomplete counts and published evidence.
- [ ] D4 Approve and perform removal of superseded code/components only after parity review.

## T. Integration and verification

- [x] T1 Reuse POS identity, permission, branch and commerce services; real PostgreSQL tests, no second stock ledger.
- [x] T2 Package the workspace into the normal POS server, with an enable flag and existing security middleware.
- [x] T3 POS migration 106 registered; fresh database migration and existing-preview preflight verified.
- [x] T4 Installed package matches source; clean locked install succeeds; test hosts/fixtures excluded.
- [x] T5 Baseline: 224 POS tests/24 suites, 24 workspace checks, four pricing-example checks, nine browser checks. See `verification/packaged-workspace.json`.
- [x] T6 Passing recorded TypeScript, lint/build, syntax and Railway source checks.
- [ ] T7 Extend tests as features land and rebuild/reinstall the package whenever runtime source changes.
- [ ] T8 Final release regression, dependency/security review, accessibility and performance validation.
- [ ] T9 Operational checks: backup/restore, migrations, logs/errors, image recovery and rollback.

## G. Source control and release

- [x] G1 Reviewed app committed as `65a4f07`; POS safeguard as `6de2d74`; unrelated POS AI edits excluded.
- [x] G2 Packaged integration committed as catalog `3f0af21` and POS `1cc61ba`; subsequent verified slices committed under the user's continuing authorization. Unrelated POS AI edits remain separate.
- [ ] G3 Authorized push/PR/release commits. No push has occurred.
- [ ] G4 Select/configure staging POS, frontend origins, branch identities and private bucket.
- [ ] G5 Deploy reviewed staging migration/backend/frontend; verify actual CORS, login, images, AI if enabled, receipts and POS navigation.
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
