# Monitoring and rollback handover

Status: operating procedure prepared; scheduling, alert delivery, named ownership
and production rehearsal are not yet accepted. This document supports G8 and does
not authorize a production release.

## Check staging now

From the catalog repository root, run:

```powershell
node app/tests/railway-health.mjs
```

The script uses only the three fixed staging origins. It requires no credentials,
does not log in or consume the login-attempt allowance, and makes no stock,
upload or AI changes. Eight bounded probes check both HTML applications, API
process health, actual database connectivity, anonymous workspace rejection,
both permitted CORS origins and rejection of a foreign origin. Exit code 1 means
at least one probe failed. Results overwrite `verification/railway/health.json`;
archive a failed result before repeating. No response bodies or secrets are saved.

On 6 September 2026, all eight probes passed on the repeat run (exit code 0).
The first run returned exit code 1 for a POS connection failure while the other
seven checks passed; it is retained in `verification/railway/health-first-run.json`.
The successful repeat does not establish the cause of that initial failure.

HTML availability alone does not prove the application boots in a browser.
API `/api/health` alone does not prove database availability; the separate
`/api/db-health` probe checks that. Foreign-origin rejection currently returns
HTTP 500 without CORS permission; the probe records that status and does not
treat it as permission to read the API.

Proposed production policy, pending owner agreement: run an equivalent approved
production-target check every five minutes from an independent runner. Escalate
two consecutive availability failures; investigate any unexpected anonymous
access or allowed foreign origin immediately. Preserve the first failure,
timestamp, service and deployment ID. Confirm from a second network before
attributing a transport failure to the application. This script does not install
a scheduler or send alerts.

## Diagnose and contain

| Symptom | Check first | Containment / recovery |
|---|---|---|
| Catalog or POS unavailable | Service deployment state, startup logs, public origin and browser network errors | Restore the recorded last known working application deployment after operator authorization |
| API healthy, database check fails | PostgreSQL service, connection pool exhaustion, private connection variables and migration errors | Pause receiving; restore database connectivity before retrying reviewed work |
| Login returns 429 for unrelated users | Auth logs, proxy/client address handling and login-attempt rate | Investigate the proxy warning below; preserve brute-force protection |
| Receipt photo missing | Existing receipt's image-transfer status and private bucket access | Use image retry for that receipt; do not receive the stock again |
| AI stalls or returns a failure | Persisted per-lot job outcome and API/provider logs | Reopen saved results first; retire abandoned work through existing recovery before an explicit new extraction |
| Stock differs from a physical count | Correct branch, recent sales, returns, receipts, transfers and movement history | Resolve with authorized, audited POS operations |

Support evidence should contain timestamps, error codes, record IDs and deployed
versions. Exclude credentials, signed photo URLs, raw provider responses and
personal data. An operator must separately check image backlog, stale AI work
and branch discrepancies; the unauthenticated probe cannot assess them.

## Open launch issue: proxy-aware login limiting

Staging logs previously reported `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
The committed POS `backend/src/server.js` does not configure Express `trust proxy`;
its limiter allows 20 requests per 15 minutes and mounts on all `/api/auth`
requests. This may group distinct clients under a proxy address. The scope of
the impact has not been reproduced with independent clients.

Before production, verify the actual trusted Railway forwarding path, implement
the appropriate client-address policy, and test both independent clients and
spoofed forwarding headers. Do not suppress validation or trust arbitrary
forwarded addresses merely to remove the warning. This remains an unresolved G8
launch issue; the health script deliberately avoids the authentication route.

## Application rollback procedure

1. Confirm the exact project, environment and service before any action. The
   staging project is `9ce0cab6-9ab1-4da3-854b-afcf4cfa914b`; its environment is
   named `production` by Railway, but the whole project is isolated staging.
2. Record current deployment IDs, source commits, workspace package version,
   migration checksums and non-secret configuration changes. Record last known
   working deployment IDs immediately before the approved release. Historical
   evidence in `verification/railway/deployment.json` is not a live rollback target.
3. Stop affected receiving/pricing work and tell the operator which reviewed
   actions are uncertain. Check persisted receipts or price history before retries.
4. Restore the chosen compatible frontend/API deployment. If containment requires
   disabling the workspace API, set `CATALOG_WORKSPACE_ENABLED=false` on the
   authorized target and deploy it; the catalog then cannot use that API.
5. Retain additive migrations and all catalog/receipt/photo evidence. Application
   rollback does not undo stock transactions. Do not restore an older database
   over ongoing commerce or independently roll back stock tables.
6. Repeat health checks, authenticated branch checks and one controlled workflow.
   Confirm receipt history and current stock remain consistent, then resume work.

Database disaster recovery is a separate approved operation: stop writes, choose
a verified recovery point, restore into a separate database, validate migrations
and stock/audit evidence, and coordinate cutover with the operator. Private photo
recovery must also preserve original object keys and bytes. A database dump alone
does not back up the image bucket. Local database restore has passed; production
database and bucket recovery acceptance remains G7.

## Required handover decisions

| Responsibility / evidence | Status |
|---|---|
| Primary monitoring operator and backup contact | Owner to name |
| Runner, alert destination and response hours | Owner to confirm; none configured by this work |
| Authority to pause receiving and initiate rollback | Owner to assign |
| Production backup retention, recovery targets and private-photo restore proof | G7 pending |
| Proxy-aware login limiting verified with independent clients | Open launch issue |
| Staff/device acceptance and approval of rollout | G6/G7 pending |

No alert messages, scheduled jobs, production changes or automatic rollbacks are
created by this handover.
