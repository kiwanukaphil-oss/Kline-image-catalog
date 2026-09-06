# Durable pricing history

Pricing's **History** opens saved and undone changes for the current account and branch. This preserves the existing POS plan ownership contract. Cards show actor, date, changed sizes and status; opening one reads the exact original before/after rows through the existing cost-redacting POS endpoint. Both receipts and exact rows are paginated.

Undo requires explicit confirmation and invokes the existing transactional POS operation. Later edits, changed quantities and published stock remain conflict blockers. Cost-bearing changes require current cost permission. Retried Undo uses the original plan identifier; it cannot produce another price change. No browser storage is required for recovery after reload.

Verification: 27 tests across workspace and pricing plan suites, including account isolation, cost redaction, original concurrency/Undo behavior; real POS browser receipt reopened after reload and previous prices restored on mobile. TypeScript/lint/build/format and installed package 0.8.0 verified.
