# Restock existing merchandise

A ready unreceived lot offers **Restock existing product** in its detail view. Find the existing POS product by name, SKU or barcode, choose each destination variant, review the exact matches and confirm.

The review states that POS selling prices and costs remain unchanged and shows any difference from the incoming lot price. Products must belong to the mapped POS category. Every incoming line requires its own explicit active variant; the server does not infer matches. Missing sizes link to POS administration before matching.

Stock, catalog links, receipt and audit commit together. Concurrent or lost-response retries cannot double receive the lot. Source quantity or POS identity/price/cost changes invalidate the signed review. Photo handoff remains independent.

Package 0.10.0 and POS ADR-079 implement the existing-variant workflow. Five focused restock tests pass; the publication/workspace suites add 30 passing tests. Desktop/mobile browser evidence in `verification/restock.json` verifies three units added to the chosen existing variant with unchanged POS price/cost. TypeScript, lint, build, format and installed-source verification pass. The complete missing-size POS round trip and broader restock acceptance remain I4; no staging or production release has occurred.
