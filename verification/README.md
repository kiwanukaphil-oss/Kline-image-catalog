# Verification evidence

Workspace commerce tests use the dedicated local `kline_catalog_workspace_test` database. Canonical POS Jest suites use their disposable `kline_inventory_pos_test` database. Source photos are copied from the approved design assets; names and commercial values in test fixtures are examples. The latest workspace and browser checks run through the normal POS server's installed package and security middleware.

- `integration.json`: 24 successful real HTTP/PostgreSQL/POS checks. Includes an actual POS sale, idempotent concurrent receipt calls, stale receiving/pricing rejection, non-cost-user redaction, independent branch balances, negative stock, configured thresholds and duplicate-photo protection.
- `browser.json`: nine successful browser journeys at desktop and 360px, using real local APIs. Includes interruption followed by a page reload and resumed image upload; shared prices and a group-size exception; separate cost entry; a changed lot requiring fresh review; a three-lot/eight-unit receipt; stock movements; dark appearance; stale refresh behavior; no uncaught page errors.
- `recovery-keyboard.json`: three successful focused checks for discoverable recovery, isolation of pending photos between accounts and keyboard dialog behavior.
- `webmcp.json`: optional tools could not be validated in a native supported context because this Chrome does not expose `document.modelContext`. This is not a UI dependency.
- `pos-packaged-workspace-jest.json`: all 224 POS tests across 24 suites pass, including seven new normal-server package, migration and security checks.
- `packaged-workspace.json`: packaged integration summary, source integrity, clean install, migration preflight and local-only release boundary.
- `stock-discovery.json`, `stock-discovery-jest.json`, `stock-discovery-browser.json`: S1 category/brand/size/barcode combinations, empty-result recovery and 360px UI against package 0.3.0; nine focused POS tests and three browser checks pass.
- `ai-fill.json`, `ai-fill-jest.json`, `ai-fill-browser.json`: R11a–c selection, sequential filling, stop/resume, failed/lost-response recovery, source evidence, human correction/audit and count confirmation. External inference is a deterministic fixture; real-provider quality remains unverified.

Screenshots prefixed `receiving-`, `pricing-`, `receipt-`, `stock-` record the inspected implementation. The final mobile product dialog was additionally measured at x=10, y=10, width=340, height=780 within a 360x800 viewport. Older `*-initial` and `browser-failure` images are retained only as debugging history, not acceptance evidence.

<!-- Removal candidates: initial and failure screenshots can be removed after owner review. -->
