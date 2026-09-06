# ADR-077: Bounded large pricing previews

Status: Implemented locally, 6 September 2026.

The real 1,000-lot / 3,000-size browser benchmark produced a 301 KB pricing proposal. Express's ordinary 100 KB parser rejected it before pricing validation and the global handler incorrectly returned HTTP 500.

Only POST `/api/catalog/pricing/preview` accepts up to 2 MB of JSON, after authentication and catalog edit permission. The ordinary parser, sanitization, downstream branch checks, proposal cardinality limits and exact review/apply contract remain in force. Oversized requests return HTTP 413 with a bounded-group message. Other endpoints retain their existing body limit.

Local development benchmark: receiving first page 311 ms; complete pricing load 459 ms across six workspace requests; select 1,000 lots 108 ms; preview 3,000 size lines 353 ms. These are local measurements using a reused real photo object, not claims about production network or unique-photo throughput. No benchmark prices or stock were applied.

Verification: full browser/POS/PostgreSQL workload; 28 focused pricing/workspace tests including unauthenticated large requests, the 2 MB cap and preservation of ordinary endpoint limits. See catalog `verification/large-delivery.json`.
