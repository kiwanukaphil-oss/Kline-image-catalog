The catalog workspace adds separate Receiving, flexible shared Pricing and current POS Stock workflows. Staff can set a common price with brand/size exceptions, preview changes and undo saved plans. Confirmed size counts and current reviews are required before receiving; retry recovery prevents duplicate stock. Existing-product restock and photo recovery preserve POS ownership.

The POS server mounts @kline/pos-workspace 0.16.0 behind CATALOG_WORKSPACE_ENABLED. Additive migrations 106–108 introduce delivery organization, photo-transfer recovery and reversible cancellation. Catalog administration, AI review, history and POS deep links enforce existing permissions and branch context. Explicit Railway client-address handling protects login rate limits without trusting arbitrary forwarded headers.

Production continuity:
- The old catalog already uses the live POS database and private bucket. Reuse all 1,031 catalog records and existing image keys; no second import or stock receipt.
- A fresh production dump was restored into a separate PostgreSQL 18 rehearsal database: all 81 table fingerprints match. Applying 106–108 preserves every pre-existing row and brings the ledger to 108 current migrations.
- All 1,237 referenced private images have local byte/hash-verified backups. One backup image was restored to the isolated staging bucket and its hash verified.
- Preserve the old frontend for pending browser queues and rollback. Three category mappings and staff access decisions remain owner-controlled; no accounts or archived categories are reactivated by this release.

Validation:
- Backend: 261 tests / 27 suites pass on dbde269, including real-database auth/proxy/audit checks. POS frontend: 22 tests pass. GitHub backend and frontend CI and Cloudflare Pages preview pass.
- Separate Railway staging verifies actual receiving, interrupted uploads, receipt recovery, exactly eight received units, private photo integrity, AI review and cross-app branch/session handling.
- Both requested pricing examples pass live Save and Undo on 1,000 lots / 3,000 size lines each. The 2,000-draft pricing load improved from 12.6s to 6.0s in the recorded comparison; unique-photo/concurrent-user throughput is not established by that fixture.
- Companion catalog production build, TypeScript, lint and migration-interface browser checks pass, including displaying existing merchandise and preserving historical field values during unrelated edits.
- The secondary Vercel preview status is failed and its logs require separate authentication. Vercel is not the live POS destination; Railway staging and the actual Cloudflare Pages preview passed. No check is bypassed or represented as passing.

Deployment: existing Railway production predeploy applies only the pending migrations; enable the workspace, exact catalog CORS origin and Railway client-address mode. Verify live reads/upload with the owner's account. Physical-phone acceptance and monitoring ownership remain handover items.

Companion app, checklist and evidence: https://github.com/kiwanukaphil-oss/Kline-image-catalog
