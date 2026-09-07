# Production replacement review, 7 September 2026

The new catalog is deployed against the same POS database and private image
bucket as the original app. It preserves existing IDs, history, prices, image
keys and stock receipts; no duplicate import is performed. The original origin
remains available for unsent browser queues and rollback.

The live audit identified three unmapped categories and inactive earlier catalog
accounts. Category creation/mapping and staff-access decisions were requested;
none were silently reactivated. Existing merchandise opens without requiring
invented deliveries. Historical attribute choices remain visible and unchanged
during unrelated name edits.

POS PR #1 merged as `6038486`; the Railway backend and Cloudflare frontend are
deployed. Catalog `6aea4e2` is deployed in a separate production frontend project.
The first backend deployment correctly stopped at its backup gate. The canonical
production migration command then applied only 106–108 using the verified local
dump with the guard enabled; redeployment succeeded.

Verification: a consistent production dump restored into a separate PostgreSQL
18 database with all 81 table fingerprints matching. Migration rehearsal preserved
all pre-existing rows. All 1,237 image objects were backed up and hash-verified;
one was restored into the private staging bucket and matched byte-for-byte.
Post-migration checks match all 23 catalog/commerce tables and report 108 current
migrations with no checksum drift. The temporary staging database proxy was
removed after rehearsal. Production's pre-existing proxy was preserved.

The two frontend compatibility fixes pass focused browser checks, TypeScript,
lint and the Node production build. The release baseline passes 261 backend and
22 POS frontend tests; Cloudflare deployment passed. A secondary Vercel preview
failed and requires separate authentication to inspect; it is not the live POS
destination. Local network failures are retained in health evidence. A manual,
credential-free GitHub health workflow passed all eight public production checks in run 34156463030. Failure samples remain preserved.

Applied POS decisions include ADR-006/059 permissions/branch boundaries,
ADR-009 real database verification, ADR-069/071/073 safe publication and locked
review snapshots, the workspace feature decisions through ADR-086, and ADR-087
explicit Railway client identity. No auth bypass or duplicate stock ledger was
introduced. Automated `/review` and `/check` commands are unavailable; source
review and the recorded checks are the local fallback.

Remaining: owner sign-in for actual production catalog upload verification,
category/access decisions, physical-phone/staff acceptance and monitoring
ownership. These are open in `docs/production-cutover-plan.md` and
`COMPLETION_CHECKLIST.md`; deployment is not represented as full acceptance.
