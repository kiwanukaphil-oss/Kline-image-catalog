# Railway staging handover

Created on 6 September 2026 at the owner's request. This is a separate project;
the existing `dynamic-balance` production POS was not changed.

| Component | Address / identifier |
|---|---|
| Project | `kline-catalog-staging` / `9ce0cab6-9ab1-4da3-854b-afcf4cfa914b` |
| Environment | `f5099338-7b6a-425b-8a78-fea771ff5809` (Railway's default name is `production`; the entire project is staging) |
| Catalog | https://catalog-web-production-2d56.up.railway.app |
| POS | https://pos-web-production-fee4.up.railway.app |
| API | https://pos-api-production-07c3.up.railway.app/api |
| PostgreSQL | `2ffc064d-f2ec-4431-88b4-8866bd6f1784`, separate persistent volume, PostgreSQL 18 |
| Private photos | `catalog-images` / `965bc135-f473-4388-bf03-61f1555377b6` |
| Branch | `Staging Main` / `a1c58076-0210-4582-ba91-6da346ea602e` |

The catalog tracks its own repository's `main`. Both POS services track
`catalog/workspace-release`, currently containing the reviewed package and
frontend deployment configuration. POS production `master` is unchanged.

## Runtime and configuration

The catalog root is `/app`. Set `KLINE_RUNTIME=node`, `HOST=0.0.0.0`, `PORT=8080`,
`NEXT_PUBLIC_POS_API_URL` to the API above and `NEXT_PUBLIC_POS_URL` to the POS UI.
Railway installs dependencies, runs `npm run build`, then starts
`node dist/standalone/server.js`. The framework's standalone output is verified
both locally and in Railway's Linux runtime. Existing local Workers previews
remain supported. Railway's connector deprecated config-as-code updates, so
service settings are authoritative; `app/railway.toml` is retained as a legacy
reference/removal candidate.

The POS API root is `/backend`, with `npm ci --omit=dev` and `npm start`.
Healthcheck is `/api/health`. It uses private PostgreSQL reference variables,
`NODE_ENV=production`, `BRANCH_MODE=active`, `CATALOG_WORKSPACE_ENABLED=true`,
and exactly the two frontend origins in `CORS_ORIGINS`. JWT and bucket keys are
new staging secrets. No production credentials or transactional data were copied.

The POS UI root is `/frontend`. Its Dockerfile builds the Vite app and serves
it with Nginx on port 8080, preserving SPA deep links. Public build variables are
`REACT_APP_API_URL` and `REACT_APP_ENABLE_BRANCH_SELECTOR=true`.

## Identity and initial data

The canonical 108 migrations were applied once to the empty staging database.
Unused seeded accounts were disabled and the administrator was renamed to
`staging-admin` with a random password before application login became available.
Local credentials are in ignored `.test-data/staging-login.txt`; they are not
published in Git or application bundles. The two apps have separate login
sessions and share the staging POS identity store.

The seed migrations create sample POS merchandise. Catalog categories Trousers,
Formal shirts and Shorts were added through the audited schema API and mapped
to the appropriate available POS categories. `Railway acceptance delivery`
contains three received test lots totalling eight units. All of this is test data.

## Verified on Railway

See `verification/railway/browser.json`, `handoff.json`, `deployment.json` and
the associated screenshots. The full browser journey exercises interrupted
uploads/reload, details, counts, shared pricing with a size exception, costs,
review, a competing edit, partial receipt recovery, current stock and failed
refresh retention. Real photos transfer byte-for-byte and unsigned bucket reads
are denied. POS pricing/stock links preserve branch and destination across
separate and expired logins; an unauthorized branch remains blocked. CORS only
allows configured origins, anonymous workspace requests are rejected, and all
migration checksums are current.

Repeat the browser test with `KLINE_PREVIEW_URL`, `KLINE_TEST_USERNAME`,
`KLINE_TEST_PASSWORD`, `KLINE_EVIDENCE_DIR` and `KLINE_TEST_DELIVERY` supplied
through the environment. It creates test stock, so use a fresh isolated fixture
for a full repeat. `app/tests/railway-handoff.mjs` checks the existing acceptance
delivery without adding more stock and is guarded to this staging project.

## Remaining acceptance

The owner configured `OPENAI_API_KEY`; `CATALOG_AI_ENABLED=true` is now deployed.
Two real photos completed extraction using the configured default model. Staff
names, brands and colours were preserved; counts remain unconfirmed and no stock
was received. Printed/handwritten size evidence and handwritten LINEN were
retained, while uncertain fabric inference is marked low confidence. Reopening
saved results made no new extraction requests. Evidence is in
`verification/railway/ai-provider.json`; wider staff quality acceptance remains.

Set `AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED` on the staging API.
Deployed uploads failed with an unsigned-header error after redeployment;
uploads succeeded with this S3 compatibility setting. The setting uses the
[documented AWS SDK checksum control](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html).
Private photo byte-integrity and POS handoff checks passed again afterward.
TLS, request signing, conditional writes and application SHA-256 verification
remain in place.

The owner/staff must complete the uncoached tasks in `staging-acceptance.md`
and physical-phone camera, installation and sharing checks. Automated browser
success cannot certify those. Production database and bucket recovery,
monitoring/rollback ownership and explicit rollout approval remain separate
gates. Staging currently has a persistent database volume; PITR is not enabled.
No claim of a production backup/restore drill is made.

The temporary public PostgreSQL maintenance proxy was removed after migration
and checksum verification. Application traffic uses Railway private networking.

## Pricing scale and mobile browser acceptance

`app/tests/railway-scale.mjs` creates or reuses a guarded synthetic staging
delivery, exercises 1,000 lots / 3,000 size lines, verifies every saved price
directly in PostgreSQL, then uses mobile Undo and verifies all prior null prices
are restored. `KLINE_SCALE_SCENARIO=shorts` tests the H&M brand exception;
the default tests the Hugo Boss XL exception. No stock is published.

The scale checks exposed sequential page loading. The frontend now loads up to
three pricing pages concurrently, preserving page order and complete selection.
Failures discard the incomplete result; an abandoned scope stops further page
groups. Focused tests cover ordering, concurrency, cancellation, page failure
and explicit selection scope. Compare `shorts-scale-before.json` with the final
`shorts-scale.json` in `verification/railway` for observed network timings.

The actual staging service worker also passes share POST, IndexedDB persistence,
offline/reconnect, authenticated review and private-cache exclusion. Only
`/offline.html` enters Cache Storage. These browser checks do not certify physical
camera quality or the operating system's installed-app share picker.
