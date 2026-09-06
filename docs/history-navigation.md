# Complete receiving history

Package 0.6.0 provides `/catalog-workspace/history/deliveries` and `/catalog-workspace/history/receipts`. Both use bounded 24-record pages, stable timestamp/UUID ordering and branch-scoped literal substring search. Receipts can be found by merchandise name, delivery title or receipt UUID. Delivery-scoped receipt views retain their context. No history is discarded when a page changes.

Earlier array endpoints remain compatibility/removal candidates for older callers. The current UI uses complete paginated history. Empty searches offer Clear search; historical receipt details link to the original photographed lot and its independent photo recovery action.

Validation: 205 receipt traversal with equal timestamps, unique-ID search, out-of-range totals, invalid-page rejection and delivery counts in real PostgreSQL/POS tests (11 workspace tests pass). Desktop/mobile browser verifies 27 deliveries across pages, empty-search recovery and access to an older real receipt. Existing receiving regression and 24 workspace checks remain passing.
