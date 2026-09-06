# ADR-073: Pin receiving to the reviewed catalog snapshot

Status: Accepted for local implementation; deployment requires release review.
Date: 2026-09-06

## Context

ADR-069 makes each photographed lot atomic and idempotent, but a valid edit between the receiving review and publication can change the stock or price received. The new K-Line workspace must receive the exact reviewed evidence. Existing catalog clients must retain their publication contract.

## Decision

The publication service issues a domain-separated HMAC revision over the complete publication context and the reviewing actor/branch. Costs remain inside the signature input and are never returned by this helper. Workspace detail returns this opaque publication revision with its safe review projection. The workspace receive endpoint requires it and passes it to the POS publication service. The existing publish endpoint accepts it optionally for backward compatibility.

Publication acquires the item lock first, then reads joined publication inputs with a fresh statement and locks ordered variant lines. This prevents a statement that waited for the parent lock from retaining a pre-wait cost snapshot. Existing pricing writers acquire the parent before child/cost writes (ADR-071). The service compares the revision before any POS mutation in that same transaction. A mismatch returns 409 and requires explicit review of current values; the UI does not silently refresh and receive them.

Already-completed publication is reconciled before revision comparison. A lost response or concurrent retry returns the original receipt and never creates additional stock. Tokens authorize no action by themselves: ordinary JWT, branch and catalog.publish checks remain mandatory. This token pins values, not a durable approval or an expiring reservation. Publication still repeats readiness validation and uses its captured context for all product, variant and stock writes.

## Validation

Real PostgreSQL tests cover stale identity, quantity, retail and protected cost changes, invalid/cross-actor revisions, blocked concurrent cost commits, successful review and idempotent retries. POS regressions use canonical serial Jest/supertest infrastructure (ADR-009). Workspace HTTP/browser journeys use the existing separate local fixture database and exercise the consuming UI. No schema migration is needed for this safeguard.

## Consequences

The workspace requires a POS backend exporting the reviewed publication contract and fails at startup if it is unavailable. The legacy client remains compatible but does not gain a pinned review until it supplies the token. Each lot remains an independent receipt transaction; a multi-lot delivery may partially succeed and shows per-lot outcomes. Production adapter mounting and migration of delivery organization tables remain separate release work.
