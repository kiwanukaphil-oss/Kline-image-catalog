# ADR-076: Independent catalog photo handoff

Status: Implemented locally, 6 September 2026. Live private-bucket acceptance remains pending.

Receiving must not depend on object storage availability. Migration 107 records a durable photo task in the stock publication transaction and backfills received catalog items. The workspace attempts the copy after that transaction commits; subsequent retries use a separate permission- and branch-checked endpoint.

The service preserves the original, validates image metadata, copies bytes to an immutable `pos-products/catalog/<item>/<sha256>` key, and verifies destination metadata and length. Only object keys are stored. Product attachment locks the task and product, creating one primary gallery entry only when no existing imagery is present. Manual imagery wins. Concurrent or lost-response retries do not duplicate gallery rows, downgrade a completed status, or execute stock mutations. A removed/replaced POS image is not silently restored by later retries.

Pending and failed tasks remain visible from the receipt's lot details with an explicit retry action. They need no transient running lease. Source and destination reads occur outside the database transaction. Previously published orphan object copies are retained, as required by the immutable image lifecycle; garbage collection is a separately reviewed removal candidate.

Verification: 29 real PostgreSQL/POS tests across handoff, workspace and publication suites; desktop/mobile browser outage recovery with exact original bytes; 24 workspace integration checks. External object storage alone is substituted locally. Actual bucket credentials, object headers and availability must be exercised during staging acceptance.
