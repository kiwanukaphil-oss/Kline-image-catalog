# Category mappings

An authorized user can choose **Connect POS category** on an unmapped receiving item, or open **Category mappings** from the toolbar. Category ancestry distinguishes repeated names. Each save connects one catalog category to an active POS category across branches; receiving readiness refreshes immediately.

POS enforces `catalog.view`, an authorized active branch and `settings.categories`. Signed revisions reject stale edits. Category locking and target validation protect concurrent writes; actor and before/after values are audited in the same transaction. Mapping changes do not rewrite existing stock or receipts.

Verified with 15 focused POS tests, 24 workspace checks and the actual browser at desktop and 360px. Package 0.9.0 matches installed source. Build, TypeScript, lint and formatting pass. Evidence: `verification/category-mappings.json` and accompanying screenshots. Live staging acceptance remains open.
