# Release operations

Release candidate: workspace 0.16.0 with POS migrations 106?108. No production migration or deployment has occurred.

## Verified locally

`node server/tests/backup-restore.cjs` exports a repeatable-read PostgreSQL snapshot, makes a custom-format backup and restores into a new `kline_restore_<timestamp>` database. It never overwrites or drops a database. All 13 checked evidence/stock/audit table counts match. The backup remains in the operating-system temporary directory; its filename is printed by the command. `node server/tests/migration-recovery.cjs` compares the active and restored fixtures with canonical migration checksums: 108 applied, none pending or mismatched.

The canonical POS tests verify that disabling CATALOG_WORKSPACE_ENABLED removes the mount. This retains delivery, photo, cancellation and receipt data. Disabling a UI is not a reversal of received stock; corrections remain audited POS operations. Migrations are additive and should remain installed during an application rollback.

Photo-transfer failures are recoverable independently of stock receipt. AI progress checks retire abandoned local jobs without silently repeating a paid request. Public API errors remain bounded; service details are in server logs. Never copy tokens, signed image URLs, raw provider bodies or customer data into a public support report.

## Staging and production gates

The isolated Railway project `kline-catalog-staging` is deployed and verified. See `railway-staging.md` for exact origins, identities, services and evidence. The existing `dynamic-balance` production project remains unchanged. Live AI integration passes; broader staff AI quality, physical-device and uncoached staff acceptance remain required.

See [monitoring and rollback](monitoring-and-rollback.md) for the repeatable read-only staging health check, incident actions, verified proxy/login-limiter policy and outstanding ownership decisions. This is a prepared runbook, not configured continuous monitoring.

Before production: take and verify a fresh database backup, verify private object storage recovery separately, record the deployed backend/frontend versions and rollback targets, and review migration status. Do not restore a backup over live commerce as an ordinary application rollback. Monitor startup/migration errors, authentication/CORS failures, photo-transfer backlog, stale AI jobs and branch stock discrepancies. The owner must accept staging and approve the production rollout.

## Repeating browser verification

Keep the catalog frontend on port 5198 and POS frontend on 3000 with the local API origin on 5109. Stop only the dedicated test preview before `node server/tests/browser-regression.cjs`; the runner refuses an occupied port and owns a fresh loopback-only preview per case. This preserves real authentication limits while isolating cases. The runner leaves port 5109 stopped at completion; restart `node server/tests/preview.cjs` for interactive use.

The accessibility script uses axe-core from `%TEMP%/kline-accessibility-tools/node_modules`; it is verification tooling, not a shipped application dependency. The POS frontend's full Vitest run passed with `--pool=threads --maxWorkers=1 --no-file-parallelism`; its parallel Windows run stalled.
