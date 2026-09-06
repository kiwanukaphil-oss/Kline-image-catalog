# Verification evidence

All commerce tests use the dedicated local `kline_catalog_workspace_test` database. Source photos are copied from the approved design assets; names and commercial values in test fixtures are examples.

- `integration.json`: 23 successful real HTTP/PostgreSQL/POS checks. Includes an actual POS sale, idempotent concurrent receipt calls, stale pricing rejection, non-cost-user redaction, independent branch balances, negative stock, configured thresholds and duplicate-photo protection.
- `browser.json`: eight successful browser journeys at desktop and 360px, using real local APIs. Includes interruption followed by a page reload and resumed image upload; shared prices and a size exception; separate cost entry; a three-lot/eight-unit receipt; stock movements; dark appearance; stale refresh behavior; no uncaught page errors.
- `recovery-keyboard.json`: three successful focused checks for discoverable recovery, isolation of pending photos between accounts and keyboard dialog behavior.
- `webmcp.json`: optional tools could not be validated in a native supported context because this Chrome does not expose `document.modelContext`. This is not a UI dependency.

Screenshots prefixed `receiving-`, `pricing-`, `receipt-`, `stock-` record the inspected implementation. The final mobile product dialog was additionally measured at x=10, y=10, width=340, height=780 within a 360x800 viewport. Older `*-initial` and `browser-failure` images are retained only as debugging history, not acceptance evidence.

<!-- Removal candidates: initial and failure screenshots can be removed after owner review. -->
