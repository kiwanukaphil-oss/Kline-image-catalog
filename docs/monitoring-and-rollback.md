# Monitoring and rollback handover

Status: operating procedure prepared; scheduling, alert delivery, named ownership
remain pending. Database and private-photo recovery rehearsals passed on 7 September 2026. This document supports G8 and does
not authorize a production release.

## Check staging now

From the catalog repository root, run:

```powershell
node app/tests/railway-health.mjs
```

The script defaults to the three fixed staging origins. Add `--production` to probe the fixed live origins and save `verification/production-health.json`. It requires no credentials,
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
After the auth deployment, further transport failures occurred on varying probes;
a failure sample is retained in `verification/railway/health-after-auth-first-run.json`.
The final eight-probe run passed with `node --dns-result-order=ipv4first
app/tests/railway-health.mjs`; the evidence records that option. DNS inspection
returned an IPv4 address, so this result does not prove IPv6 caused the failures.
The separate actual browser/POS/private-photo regression also passed.

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
| Login returns 429 for unrelated users | Auth logs, proxy/client address handling and login-attempt rate | Verify CLIENT_IP_SOURCE and ingress assumptions below; preserve brute-force protection |
| Receipt photo missing | Existing receipt's image-transfer status and private bucket access | Use image retry for that receipt; do not receive the stock again |
| AI stalls or returns a failure | Persisted per-lot job outcome and API/provider logs | Reopen saved results first; retire abandoned work through existing recovery before an explicit new extraction |
| Stock differs from a physical count | Correct branch, recent sales, returns, receipts, transfers and movement history | Resolve with authorized, audited POS operations |

Support evidence should contain timestamps, error codes, record IDs and deployed
versions. Exclude credentials, signed photo URLs, raw provider responses and
personal data. An operator must separately check image backlog, stale AI work
and branch discrepancies; the unauthenticated probe cannot assess them.

## Verified Railway login identity

Resolved in staging at POS commit `dbde269` (ADR-087). Explicit
`CLIENT_IP_SOURCE=railway` selects a validated `X-Real-IP` for IP rate keys and
request audit records. Socket identity remains the default elsewhere. Railway
[documents the header](https://docs.railway.com/networking/public-networking/specs-and-limits),
and its [staff confirm the edge overwrites it](https://station.railway.com/questions/need-authoritative-railway-client-ip-p-b7a7b4bd).
The staging API has no public TCP proxy; private-network peers must remain trusted.
Global Express proxy trust is disabled. Missing or invalid edge headers fall back
to the socket address, and IPv6 limiter keys retain subnet normalization.

The 20-attempt / 15-minute auth allowance is unchanged, but GET session reads no
longer spend it. Twelve real Express/PostgreSQL tests cover independent clients,
spoofed chains, IPv6 rotation, direct mode, malformed headers, audit records,
limit exhaustion and session access after exhaustion. All 261 backend tests pass.

Actual staging verification shows 25 session reads consume no login attempts;
caller-supplied X-Real-IP, X-Forwarded-For, Forwarded and CF-Connecting-IP headers
do not split the bucket. See `verification/railway/auth-proxy.json`. Two initial
runs hit local connection timeouts after successful API responses; the completed
run passed after the probe consumed session response bodies to reuse connections.
This does not establish the cause of every earlier transport timeout.

This is still a process-local limiter. Deployments reset counters and multiple
replicas have independent counters. Add a distributed policy before scaling the
API to multiple replicas. Revalidate client identity when changing ingress
providers or exposing additional network paths.

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
| Proxy-aware login limiting | Verified locally and on staging; independent clients/IPv6 tested locally, real edge spoof resistance verified live |
| Staff/device acceptance and approval of rollout | G6/G7 pending |

No alert messages, scheduled jobs, production changes or automatic rollbacks are
created by this handover.

## Production rollout, 7 September 2026

See [production cutover](production-cutover-plan.md) for live service IDs, backup evidence and rollback versions. The production process/database, workspace authentication rejection and both allowed CORS origins have returned expected responses. Local transport failures occurred intermittently across different endpoints; preserve `verification/production-health-first-run.json` and `production-health-second-run.json`. A passing response on retry does not establish their cause. The existing POS Administrator browser session still shows 270 units across 213 products after deployment.

The manual GitHub Actions workflow `.github/workflows/production-health.yml` passed all eight checks in [run 34156463030](https://github.com/kiwanukaphil-oss/Kline-image-catalog/actions/runs/34156463030), independently of this workstation. It uses fixed public origins, no credentials, no database mutations and retains JSON evidence even on failure. It is not scheduled; an alert recipient and monitoring owner remain undecided. Workflow mechanics follow [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) and [artifact retention](https://docs.github.com/en/actions/tutorials/store-and-share-data).
