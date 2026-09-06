# K-Line implementation review

6 September 2026 · Packaged POS integration · Ready for local review

The ongoing task list is [COMPLETION_CHECKLIST.md](COMPLETION_CHECKLIST.md). It distinguishes verified local implementation, release gates and optional scope, and will be updated as we proceed.

### Latest completed task: R11a–c — AI fill workflow

AI fill is now a visible selected-lot action and a single-photo action. Staff can run selected photos sequentially, stop after the current photo, review persisted results and explicitly retry failures after checking saved progress. The app reconciles an uncertain response instead of automatically issuing another paid request. Existing POS fill-empty protection remains authoritative.

Uncertain suggestions show confidence and expandable evidence beside editable fields. Saving reviewed details uses the signed edit revision, records reviewed keys, clears reviewed/changed fields' AI confidence markers and preserves source observations. Physical quantities still require separate confirmation. Unsaved inputs and in-flight operations are protected.

Package 0.4.0 is installed and matches source. Validation: 21 focused POS tests, four AI workflow browser checks and 24 workspace integration checks, plus TypeScript, lint, formatting and build. Desktop/mobile screenshots were inspected. Only the external inference boundary was replaced for the AI browser test; no real-provider accuracy or staging claim is made. AI actions remain capability-gated, and the ordinary local preview keeps live AI disabled. See `docs/ai-fill-workflow.md`, ADR-075 and `verification/ai-fill.json`. Real-provider quality, staff usability and orphaned-job recovery remain R11d. No new commit, push or deployment was made.

### Latest completed task: S1 — stock discovery

Stock now combines exact POS category/brand filters with size and availability filters, and searches variant barcodes alongside product names, brands and SKUs. Category choices use full paths. Filter choices remain available after an empty result; Clear filters restores the list. No stock or pricing data is changed by filtering.

The workspace package was rebuilt as `0.3.0` and installed in the normal POS host. Its seven files match source. Nine focused POS tests, three new desktop/mobile browser checks and all 24 workspace integration checks pass, as do TypeScript, lint, formatting and the production build. The desktop/360px screenshots were inspected. Evidence: `verification/stock-discovery.json`. The earlier 224-test full-suite result remains the packaged-integration baseline; the focused suite was rerun for S1. Next functional task: I1, durable photo handoff into POS.

The approved direction is implemented in `C:\Projects\Kline Image Catalog`, with `origin` set to `https://github.com/kiwanukaphil-oss/Kline-image-catalog.git`. Following owner approval, the reviewed app was committed as `65a4f07` and its POS receiving safeguard as `6de2d74`. Unrelated POS AI changes were excluded. Neither commit has been pushed or deployed.

Receiving now groups deliveries, saves interrupted photo uploads for recovery, edits category-based details, confirms physical size counts and shows the next task per lot. Pricing has a visible, dedicated workflow for selecting similar merchandise, entering a shared selling price, adding size exceptions, reviewing exact changes and saving. Costs are separate. Stock reads actual POS variant/branch availability with search, size and shortage filters, movement history and an explicit freshness state.

The working preview is **http://localhost:5198**, also available at **http://[::1]:5198**. Use **testadmin / testpass123** against **Test Store**. These are isolated test credentials and example data. `New arrivals` contains editable drafts; `September delivery` contains received merchandise. The frontend is running locally with the existing POS services and a separate PostgreSQL test database.

## What was verified

- TypeScript, application lint, production build and dependency audit. The generated scaffold's vulnerable dependencies were updated together; the final audit reports zero vulnerabilities.
- 24 real HTTP/POS/PostgreSQL workspace checks, plus 29 canonical POS Jest/supertest publication and pricing tests. A six-unit receipt creates exactly six units, even under concurrent retry. A subsequent POS sale changes Stock to five while the historical receipt remains six.
- Protected existing/inherited prices, size exceptions, independent cost saves, cost redaction, stale identity/count/price-plan rejection and conditional undo.
- POS-only products, depleted sizes, negative balances, configured reorder levels, independent branch quantities and multiple evidence photos without multiplied stock.
- Nine browser journey checks across desktop and 360px mobile, plus the earlier focused recovery/account-isolation and keyboard checks. Interrupted uploads survive a page reload. A three-lot delivery receives eight units. A real edit after receipt review requires a fresh review while completed lots stay received. Returning from Pricing keeps the delivery open. Failed stock refreshes keep a timestamped snapshot and say that the update failed.

Evidence is in `verification/`. Local Playwright with installed Chrome provided repeatable interaction tests and screenshots when the browser connector was unsuitable earlier in the design work. Optional native WebMCP support was not available in this browser; that validation gap is recorded separately.

## Integration and release boundary

### Packaged POS integration after commit approval

`@kline/pos-workspace@0.2.0` is installed from a versioned tarball in the POS backend's `vendor` directory, pinned by its package-lock. Its five runtime modules reuse the host POS dependencies. Tests, fixture credentials and test-only image storage are excluded. The normal POS server mounts it behind `CATALOG_WORKSPACE_ENABLED=true`, after the existing security middleware. POS migration 106 owns the two delivery tables; both the canonical fresh database and existing local preview applied it successfully.

Fresh validation: **224/224 POS tests across 24 suites**, **24/24 workspace integration checks**, **4/4 pricing-example checks** and **9/9 browser checks** through the installed package. The installed package matches its source, a clean locked dependency install resolves it, the preview's schema preflight passes, and the Railway runtime source check passes. See `verification/pos-packaged-workspace-jest.json` and `verification/packaged-workspace.json`. This phase adds no frontend UI changes; its existing build/lint checks remain recorded, with TypeScript checked again against the integration.

ADR-074 records packaging, migration ownership, the enable flag and release sequence. These new changes are awaiting review separately from the two completed commits. Production credentials, buckets, CORS origins and deployment configuration were not changed.

### Pricing refinement after local review

Pricing now supports exact category, brand and size filters, word search, and selection of every matching lot across display pages. Optional brand/size exception rows expand to the selected sizes; different prices on overlapping exceptions block review instead of depending on rule order. Individual overrides remain available. The authoritative review groups results by price, with paginated exact changes available to inspect. Staff can price another group after saving.

Six group-logic checks cover 1,000 lots / 3,000 sizes, both requested examples, conflicts, matching, partial-size protection and grouped review totals. Four additional real POS/PostgreSQL checks verify generated proposals, saved size/brand exceptions, independent costs, Undo and stale-plan rejection. See `verification/pricing-groups.json` and `verification/pricing-groups-integration.json`. The 1,000-lot check exercises matching and proposal compilation; it is not a full browser or database load benchmark. The latest browser journey uses the group-size exception control and completes review/save on mobile; the refreshed desktop and mobile layout screenshots have been inspected. Lint, TypeScript, formatting and the production build pass.


The new server adapter reuses the existing POS authentication, permission, branch, stock-normalization and publication services. Additional schema is isolated to receiving organization. Its migration was applied only to `kline_catalog_workspace_test`. This integration phase also ran the POS's canonical Jest setup, which recreated its disposable `kline_inventory_pos_test` database and applied all 105 migrations. No live database was changed.

The next integration is now implemented locally: the normal POS server mounts the installed `@kline/pos-workspace@0.2.0` package when explicitly enabled, and POS migration 106 tracks the two delivery tables. The runtime artifact excludes test hosts, fixtures and credentials. Production CORS, live private bucket access, AI extraction and POS cross-app login/deep-link behavior have not been exercised. See `docs/pos-release.md` for the concrete rollout sequence.

The receiving concurrency gap is closed locally. The POS publication service signs the complete reviewed context for the actor and branch, then checks it under the publication transaction's locks before creating stock. Lock acquisition now precedes the joined cost read. Changes to identity, quantity, retail or protected costs require a fresh review. A completed receipt reconciles before token comparison, so concurrent retries preserve exactly one receipt. The workspace requires this contract and fails at startup against an older POS service. The legacy publisher remains backward compatible for older clients. See POS ADR-073 and `verification/pos-receiving-jest.json`.

Follow-up capabilities from the approved direction include a durable image handoff into the POS product-image field, explicit restock matching to existing products, additional evidence photos on one lot, reusable price lists, deeper receipt pagination and administration parity. Stock already shows linked catalog images; copying those images into POS itself is a separate step.

## Preservation and review

The original image app and POS source checkouts retain their pre-existing changes. This phase adds focused POS controller, publication service/repository and regression-test changes plus ADR-073; the unrelated AI edits remain intact. The prior design brief is preserved as `design/DESIGN_REVIEW.md`, and old concepts remain available. Removal candidates are marked in comments rather than deleted.

The new packaged-integration changes are awaiting review; the earlier app and receiving-safeguard commits are already complete. Review the local workflows and `docs/pos-release.md` before committing this next change or deploying it. The local preview now runs through the installed package and normal POS security middleware.

## Photo handoff — I1/I2

Implemented independent durable photo recovery (POS ADR-076, migration 107, package 0.5.0). Original bytes are preserved; retries cannot repeat stock receiving or overwrite manual POS imagery. Verified 29 focused POS tests, 24 workspace checks, desktop/mobile outage recovery, TypeScript, lint, formatting and build. Live private-bucket acceptance remains staging work. Next: receipt/delivery history navigation.

## Complete receipt and delivery history — R9

Package 0.6.0 adds bounded search and pagination across complete branch history. Verified 205 receipts without repeats, 27-delivery browser pagination, older receipt-ID lookup and clear-search recovery. Eleven focused POS tests, 24 workspace checks, build, TypeScript, lint and formatting pass. Previous array routes remain compatibility removal candidates. Next: full photo inspection.

## Photo inspection — R10

Implemented in-app zoom/fit, fresh-URL reload independent of unsaved form state, and an audited photo/label hold using existing flag publication blockers. Twelve focused POS tests, desktop/mobile browser recovery, 24 workspace checks and frontend checks pass. Package 0.7.0; next P10 durable pricing history.

## Durable pricing history — P10

Added current-account/branch applied and undone receipt history, actor/date metadata, exact original rows, protected cost reads and confirmed Undo after reload. Reuses existing POS plan ledger and transactional safeguards. Verified 27 focused POS tests, desktop/mobile reload and Undo, frontend checks, package 0.8.0. Next P11 full 1,000-lot benchmark.

## Large-delivery verification — P11

The real 1,000-lot benchmark found and fixed POS's 100 KB body-parser rejection for reviewed pricing. ADR-077 bounds authenticated preview payloads at 2 MB; other limits remain unchanged and oversized requests return 413. Locally: full pricing load 459 ms, selection 108 ms, review of 3,000 sizes 353 ms. Twenty-eight focused POS tests pass. No benchmark prices/stock applied; production network and unique images remain staging checks. Next S5.

## Stock flows and current regression

S5 verified with real POS adjustment, sale, sellable return, transfer dispatch and destination receipt. Stock cards refresh the exact SKU and branch; mobile movement history shows the destination transfer. Full current POS regression: 235 tests across 25 suites pass (`verification/pos-regression-current.json`).

## POS navigation — S6 in progress

Implemented product/branch/tab handoff, local post-login return paths and product permission gating. Both frontend TypeScript checks pass; catalog lint passes. Browser acceptance is blocked because automatic approval review rejected hidden and foreground POS frontend startup with `blocked by policy`. Backend preview is refreshed. User-run `server/tests/start-pos-preview.ps1` unblocks the required browser checks; see `docs/pos-navigation-work.md`. S6 is deliberately uncommitted and unchecked.

## S6 completed

User-started POS preview confirmed on Vite port 3000. Corrected development links and helper. Browser verifies independent login, exact product/tab/branch, expired-session recovery and denied branch. Fixed login guard/form redirect race and preserved local destination on 401. Six redirect tests and both frontend TypeScript checks pass; catalog lint/build/format pass. Staging remains separate.

## R16 ? reversible intake cancellation

Package 0.14.0 adds reviewed cancellation/restore and saved-phone cancellation, with retained evidence and membership. POS migration 108 reserves cancelled IDs against late uploads. 41 focused integration tests and actual mobile browser checks pass; lint/typecheck/build and installed source comparison pass. No production migration or deletion occurred.

## R12 ? session and navigation recovery

Expired authentication now opens same-account sign-in over the mounted workspace; draft input and active branch survive. Pricing/navigation guards distinguish unsaved work from in-flight writes. Real browser 401 and branch/destination discard/keep paths pass, as do TypeScript and lint. Physical phone acceptance remains open.

## R11d ? abandoned AI attempts

Explicit progress recovery closes stale running jobs after 15 minutes, audits recovery, blocks concurrent attempts and rejects late completion. Usage accounting remains retained. 33 focused POS tests, the complete AI browser flow, TypeScript/lint/build and seven-file installed package comparison pass. Existing unrelated AI service edits were left untouched.

## D2 ? focused administration

Workspace settings owns occasional category/field definition editing, mapping access and branch diagnostics. User administration links to existing POS routes with no token. Schema editing is additive, audited and revision checked; receiving/edit transactions share the schema lock. 23 PostgreSQL tests plus actual mobile category creation, inheritance, diagnostics and mapping checks pass. Fixed dialog intrinsic-width overflow exposed by long category names.

## Final local validation

250 POS backend tests, 22 POS frontend tests and 24 workspace integration checks pass. Dependency audits report zero advisories. Eight axe views pass after contrast and alt-text corrections. A consistent database snapshot restores with 13 matching table counts and 108 matching migrations. The 1,000-lot/3,000-size benchmark loads in 454 ms and reviews in 370 ms locally. Latest isolated browser run passes 20/21; cross-app navigation awaits the stopped POS preview (earlier same-version test passed). Staging and physical device/provider/bucket/staff acceptance are outstanding.

Clean release confirmation: detached POS 402133c passed npm ci and 249 tests/26 suites; installed package 0.16.0 matches all seven source files. Latest catalog build passes. Source and draft POS PR #1 are pushed. The remaining intervention is the policy-blocked POS preview restart and staging selection; production is unchanged.
