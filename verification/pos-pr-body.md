The catalog workspace separates new-stock Receiving, flexible shared Pricing and current POS Stock. Staff can set a common price with brand/size exceptions, review exact changes and undo saved plans. Receiving requires confirmed size counts and a current review; retries cannot duplicate stock. Existing-product restock uses explicit size matching, and photo recovery runs independently of receipts.

The normal POS server mounts `@kline/pos-workspace` 0.16.0 behind `CATALOG_WORKSPACE_ENABLED`. Migrations 106-108 add deliveries, photo-transfer tasks and reversible cancellation. Administration, AI fill/review, item history and POS deep links preserve permissions, branch context, audit records and stale-edit protection.

Railway authentication now uses an explicit validated edge-address policy (`CLIENT_IP_SOURCE=railway`) for IP rate keys and audit records. Direct deployments retain socket identity. Routine session reads no longer consume the existing 20-attempt login allowance. Global Express proxy trust stays disabled; authenticated upload/AI limits remain user-based. ADR-087 records the provider contract, configuration boundary and process-local limiter limitation.

Validation:

- All 261 backend tests / 27 suites pass on isolated release commit `dbde269`, including 12 real Express/PostgreSQL proxy, audit and auth-limit checks. Unrelated local AI edits are excluded. POS frontend has 22 passing tests.
- Catalog verification includes 24 HTTP/database cases, all 21 browser cases and eight clean accessibility scans. Local database backup/restore preserves 13 checked table counts and all 108 migrations.
- Separate Railway staging has both frontends, the API, PostgreSQL and a private image bucket. Actual receiving, interrupted uploads, partial receipt recovery, exactly eight stock units, byte-preserving private photos and cross-app session/branch handling pass.
- Both requested pricing examples pass live Save and Undo for 1,000 lots / 3,000 size lines each. Complete pricing load with 2,000 drafts improved from 12.6s to 6.0s in the recorded comparison. Synthetic lots reuse a photo; this does not measure unique-image or concurrent-user throughput.
- Live Railway auth checks confirm 25 session reads do not spend the login allowance and forged forwarding headers cannot create a fresh allowance. The staging API has no public TCP bypass.
- Two real private-photo AI runs preserve staff edits and uncertainty evidence; reopening saved results issues no new extraction request. Actual staging PWA share/offline/private-cache checks pass.

This remains a draft release candidate. Staff usability, broader merchandise AI accuracy, physical-phone acceptance, monitoring ownership and production backup/deployment approval remain open. Existing production master is unchanged. Superseded code is retained pending an explicit removal decision.

Companion app, checklist and detailed evidence: https://github.com/kiwanukaphil-oss/Kline-image-catalog
