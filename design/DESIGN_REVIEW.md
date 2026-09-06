# K-Line product and workflow review

6 September 2026 · Design review phase · Awaiting owner confirmation

The owner expanded the scope to include monitoring current stock alongside preparing new stock. Similar items usually share a price with occasional exceptions. The revised structure is Receiving, Pricing, and Stock. Stock reads current POS availability and selling prices, while Receiving retains unfinished work and historical receipts.

Deliverables:

- `design/product-direction.md`: source-based diagnosis, proposed workflows, visual direction, POS ownership and contract gaps, preservation/removal candidates, and acceptance criteria.
- `design/kline-stock-workspace.html`: revised interactive concept with current-stock search, size filtering, low/out-of-stock views, product availability and movement history. Existing photography and invented POS data stay in browser memory. No backend, real pricing, or real stock writes. The earlier `design/kline-workspace.html` is preserved as the previous proposal.
- `design/verification.json`: successful concept interaction checks. Desktop 1024px, mobile 360px, and 736px layouts inspected in light/dark variants. Local isolated headless Chrome/Playwright was used when the browser screenshot connector stalled. Screenshot evidence is in `design/`.

Validation covered zero-price rejection, protected inherited/existing prices in fill mode, size exceptions, exact before/after review, quantity confirmation, a simulated 12-unit receipt across three lots, refusal to undo published prices, and catalog search. No JavaScript errors were observed. This validates the concept only. It is not production/API/database validation or staff usability testing.

The stock revision was additionally verified through `design/.qa/check-stock.mjs`; results are in `design/stock-verification.json`. Checks cover stock quantities independent of drafts, SKU search, size-scoped totals, low/out-of-stock filters, movement details, 360px mobile layout, light/dark screenshots, and receipt additions without implicit merging. One select-label accessibility issue found during validation was corrected before the successful run. Stock screenshots are `design/stock-*.png`.

Integration evidence was read against ADR-069 (normalized lots and atomic per-item publication) and ADR-071 (reviewed price plans). Proposed new contracts include general draft field editing, authoritative readiness, persistent receiving groups/receipts, image handoff into POS, and an authoritative current-stock read by POS variant and branch with freshness and movement history. POS-only products must be included; repeated evidence photos must never multiply availability. Restock matching requires an explicit design decision; no implicit merging is proposed.

The original app and adjacent POS source were not modified. The original checkout still has its pre-existing modified `package-lock.json` and untracked `REVIEW_BRIEF.md`. No commits, migrations, or deployments were made. Authenticated production operations were not exercised.

Next phase, after approval: implement the agreed receiving-to-stock vertical slice with real backend integration, including verification that a POS sale changes Stock while the original receiving receipt remains historical. This scope amendment stays within design review and does not authorize implementation.
