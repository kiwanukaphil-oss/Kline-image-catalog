# Actual Railway acceptance

`browser.json` records the passing receiving/pricing/receipt/stock journey.
`handoff.json` records private-photo byte integrity and two-app login/branch
acceptance. `deployment.json` records healthy deployment identities, all 108
migration checksums, CORS and anonymous-access checks. Screenshots alongside
these records were captured from the deployed HTTPS apps.

`browser-failure.png` is retained historical setup evidence: the new database
initially had no catalog categories. Audited category setup was completed before
the passing run. An earlier request also arrived before the new Railway domain
finished provisioning. These are not the final acceptance result.

This evidence contains staging-only sample merchandise. Credentials, tokens,
database secrets and signed photo URLs are excluded. It does not substitute for
uncoached staff, real-phone or real-provider AI acceptance.

## Authentication hardening and health checks

`auth-proxy.json` records the deployed ADR-087 check: 25 successful session reads
without consuming login attempts, and caller-supplied forwarding headers cannot
split the login bucket. POS commit dbde269 passes all 261 backend tests / 27
suites. The deployed API has no public TCP proxy. Recent API logs contain no
proxy-validation warnings. Independent clients/IPv6 are verified locally; the
live check uses one actual network client.

`health.json` is the final passing eight-probe snapshot. `health-first-run.json`
and `health-after-auth-first-run.json` retain transport failure samples. The
final run records an explicit IPv4-first DNS option; this does not establish the
root cause of earlier connection timeouts. The repeated browser handoff and
original-private-photo checks pass in `handoff.json`.
