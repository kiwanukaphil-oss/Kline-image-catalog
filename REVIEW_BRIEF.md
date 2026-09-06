# K-Line implementation review

6 September 2026 · Working slice with pinned receiving review · Ready for local review

The approved direction is implemented in `C:\Projects\Kline Image Catalog`, with `origin` set to `https://github.com/kiwanukaphil-oss/Kline-image-catalog.git`. The new remote was empty. No commit, push, deployment or production migration has been made.

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

### Pricing refinement after local review

Pricing now supports exact category, brand and size filters, word search, and selection of every matching lot across display pages. Optional brand/size exception rows expand to the selected sizes; different prices on overlapping exceptions block review instead of depending on rule order. Individual overrides remain available. The authoritative review groups results by price, with paginated exact changes available to inspect. Staff can price another group after saving.

Six group-logic checks cover 1,000 lots / 3,000 sizes, both requested examples, conflicts, matching, partial-size protection and grouped review totals. Four additional real POS/PostgreSQL checks verify generated proposals, saved size/brand exceptions, independent costs, Undo and stale-plan rejection. See `verification/pricing-groups.json` and `verification/pricing-groups-integration.json`. The 1,000-lot check exercises matching and proposal compilation; it is not a full browser or database load benchmark. The latest browser journey uses the group-size exception control and completes review/save on mobile; the refreshed desktop and mobile layout screenshots have been inspected. Lint, TypeScript, formatting and the production build pass.


The new server adapter reuses the existing POS authentication, permission, branch, stock-normalization and publication services. Additional schema is isolated to receiving organization. Its migration was applied only to `kline_catalog_workspace_test`. This integration phase also ran the POS's canonical Jest setup, which recreated its disposable `kline_inventory_pos_test` database and applied all 105 migrations. No live database was changed.

The next production integration work must mount the adapter and migrate its two receiving tables through the POS release process. Production CORS, live private bucket access, AI extraction and POS cross-app login/deep-link behavior have not been exercised.

The receiving concurrency gap is closed locally. The POS publication service signs the complete reviewed context for the actor and branch, then checks it under the publication transaction's locks before creating stock. Lock acquisition now precedes the joined cost read. Changes to identity, quantity, retail or protected costs require a fresh review. A completed receipt reconciles before token comparison, so concurrent retries preserve exactly one receipt. The workspace requires this contract and fails at startup against an older POS service. The legacy publisher remains backward compatible for older clients. See POS ADR-073 and `verification/pos-receiving-jest.json`.

Follow-up capabilities from the approved direction include a durable image handoff into the POS product-image field, explicit restock matching to existing products, additional evidence photos on one lot, reusable price lists, deeper receipt pagination and administration parity. Stock already shows linked catalog images; copying those images into POS itself is a separate step.

## Preservation and review

The original image app and POS source checkouts retain their pre-existing changes. This phase adds focused POS controller, publication service/repository and regression-test changes plus ADR-073; the unrelated AI edits remain intact. The prior design brief is preserved as `design/DESIGN_REVIEW.md`, and old concepts remain available. Removal candidates are marked in comments rather than deleted.

Review the live local workflows and `docs/architecture.md` before the next phase. Your confirmation is still required before committing or pushing this first implementation, and separately before any deployment.
