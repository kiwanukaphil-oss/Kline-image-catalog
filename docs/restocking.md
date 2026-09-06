# Restock existing merchandise

A ready unreceived lot offers **Restock existing product** in its detail view. Find the existing POS product by name, SKU or barcode, choose each destination variant, review the exact matches and confirm.

The review states that POS selling prices and costs remain unchanged and shows any difference from the incoming lot price. Products must belong to the mapped POS category. Every incoming line requires its own explicit active variant; the server does not infer matches. Missing sizes link to POS administration before matching.

Stock, catalog links, receipt and audit commit together. Concurrent or lost-response retries cannot double receive the lot. Source quantity or POS identity/price/cost changes invalidate the signed review. Photo handoff remains independent.

Package 0.10.0 and POS ADR-079 implement the existing-variant workflow. Six focused restock tests pass; the publication/workspace suites add 30 previously passing tests. Desktop/mobile evidence in `verification/restock.json` verifies existing-variant receiving. `verification/restock-missing-size.json` verifies separate POS login, correct product/branch, adding XL in the real editor with zero opening stock, refreshing choices while preserving valid matches, and receiving three units with unchanged price/cost. Intervening stock movements remain additive and another branch stays unchanged. TypeScript, lint, build and format pass. Staging and staff acceptance remain G5/G6; no deployment has occurred.
