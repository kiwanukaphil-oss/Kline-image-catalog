# Older catalog data

Ungrouped imports remain in All merchandise with no invented delivery. Recorded quantities do not become confirmed size counts automatically. Flags and missing preparation data still block receiving.

An older POS product link is protected even if it predates the publication receipt table. Synced links remain historical. Incomplete links show Check POS link and locked details; receiving and restock require reconciliation rather than creating duplicate stock. Existing receipts stay immutable. No data is silently backfilled or deleted.

Verified with real older-style fixtures, 38 passing POS integration tests and the browser evidence in `verification/older-data.json`. Package 0.11.0 matches installed source; frontend checks pass. This validates supported data shapes locally, not the contents of a production database. Production reconciliation remains a staging/release audit.
