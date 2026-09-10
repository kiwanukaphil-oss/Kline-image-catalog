# Suggested matching implementation review

Implementation and isolated testing completed on 9 September 2026. Production deployment and a Git commit have not been performed.

Receiving now discovers exact model-code matches from saved label/caption text or manual model edits. It provides side-by-side photos, full category paths, recorded size quantities, exclusions, persistent keep-separate decisions and restoration. Opening suggestions does not call an AI model. Relevant updates and completed AI fills refresh discovery independently of extraction success.

Group confirmation saves an identity plan before counts and prices are ready. Receipt remains a separate, authoritative review and transaction. Membership locks prevent overlapping groups; stale source evidence requires a fresh comparison. Source and existing POS target identities are checked again before receipt. Existing prices, stock safeguards, rollback and idempotent retries remain in place. Conflicting material requires an explicit shared value or leaving an optional value unset; the first source no longer supplies it silently for suggested groups.

Automatic discovery is conservative: a complete model code must contain a digit and have saved printed/caption evidence, or be recorded by a manual model edit. It does not infer model identity from names, brand alone or visual similarity. Shoe sizing systems are preserved; existing XXL/2XL aliases remain supported. Unknown comparison values are treated as missing evidence. Design fields are compared according to the category definitions.

## Accuracy findings

The frozen baseline contains 67 lots and 126 confirmed units. Expected group labels are stored separately from the original extraction evidence.

| Evaluation | Result |
|---|---|
| Exact matcher with independently reviewed identities and synthetic compatible design fields | 12/12 groups, 41 grouped lots, 26 separate lots; no false groups |
| Original saved extraction | 5 correct partial groups covering 12 lots; no complete reference group recovered |
| Supported saved model evidence | 40/67 lots; supporting text is not itself proof that transcription was correct |
| Separate XL source counts | B-25 retains XL quantity 2; D9663-2A retains XL quantity 2 |
| Total baseline quantity | 126 units preserved |
| Additional model calls during discovery | 0 |

The saved extraction has errors such as `201A-6` versus `26201A-6`, `26201K-7` versus `26201A-7`, and inconsistent Tommy Dolby brand spellings. Protected nonempty fields are not automatically overwritten. This release is useful for correctly extracted or staff-corrected codes, but should not be presented as recovering every size automatically from the current stored data. Re-extraction/model comparison is a separate follow-up; no production photos were reprocessed or received merchandise regrouped.

## Validation

- `server/tests/match-candidates.cjs`: exact suffixes, punctuation, leading zeroes, brand/category boundaries, missing-design bridges, missing/unknown values, size aliases, counts and identity-only dismissal fingerprints.
- `server/tests/match-suggestions.cjs`: authenticated API tests against local PostgreSQL, including scopes, cancellation, manual evidence, exclusions, dismiss/restore, stale revisions, concurrent confirmation, unresolved material, required receipt preparation, changed identities, existing POS targets, target ambiguity/inactivation and receipt retries.
- `server/tests/product-matching.cjs`: grouped stock and gallery retention, existing variant reuse, new variants, unchanged POS prices, stale reviews, missing dimensions, whole-transaction rollback and idempotent receipt.
- `server/tests/integration.cjs`: existing upload, details, count, pricing, receipt, sale, permissions and branch-stock behavior. Database-mutating suites must run sequentially; an initial parallel run encountered a shared-stock assertion race and the isolated rerun passed.
- Browser verification used the local release build: six original photos, full category paths, unconfirmed-count labels, exclusions/restoration, persistent dismissal/reconsideration, keyboard confirmation, material resolution and stale-error recovery. A six-lot group saved before preparation, then received exactly six units after explicit fixture preparation. Original-photo access returned a complete 960×1280 image. The 360×800 phone viewport had no horizontal overflow; all evidence and actions remained reachable.
- Typecheck, lint, production Node build and whitespace checks passed. Discovery measured 28 ms for the small delivery and 38 ms for a local branch with 1,110 eligible lots; these are local measurements, not a production latency guarantee.

The older sibling backend lacked tracked migrations. Tests used the existing `C:/Projects/Inventory POS release check/backend` checkout, which matches the deployed receiving contracts. Local photo storage was used; missing cloud storage in the generic integration harness produced expected photo-handoff failure records. The dedicated grouped-gallery regression independently passed with its in-memory object store.

## Approved deployment package

1. Add the reviewed SQL in `server/migrations/002_match_suggestions.sql` to the production POS migration sequence under its next unused migration number. It adds dismissal storage and `identity_review`, and exposes optional model-code fields in clothing/footwear trees without replacing existing field definitions.
2. Deploy the `@kline/pos-workspace` 0.22.0 package with the POS backend, then the catalog frontend. The backend package includes both discovery modules and the migration. Follow the existing backup/migration checks and confirm live health before enabling the frontend UI.
3. Verify one unreceived delivery through discovery and comparison, without receiving stock or regrouping historical merchandise. Confirm full category paths and fallback manual matching.

Rollback should retain the additive database structures and user decisions. If reverting the frontend, keep the compatible backend so already-confirmed identity/material safeguards remain enforced. No cleanup or deletion migration is needed.

Owner approved deployment; the release was deployed and verified on 9 September 2026. No Git commit was created.

## Live deployment verification

Backend deployment `8fb041c9-3430-42d7-9eff-ec775597db1d` and catalog deployment `d202c7e0-6bd7-4ac6-adc9-5a02aaf6da32` both succeeded. The API returned OK. Migration 112 applied after a readable 2,204,803-byte backup; all 112 migrations are tracked with no pending migrations or checksum drift.

Signed-in live verification checked an eight-lot Namugongo delivery (no saved model evidence), optional branch-wide scope (27 lots), and Ntinda discovery (56 of 701 eligible lots have model evidence; nine candidates all require difference review). Mack Weldon 26201A-29 showed two original photos, saved label text, the full Clothing → Shirts → Formal category path, and separate unconfirmed L/XL counts. Missing pattern/material evidence was flagged and confirmation remained disabled. No groups were confirmed, merchandise edited, or stock received.

Reproducible isolated source snapshots and rollback deployment IDs are recorded in `verification/match-suggestions-release.json`. The snapshots exclude unrelated checkout changes. Source remains uncommitted under the owner’s preference; future releases must preserve this deployed package and numbered migration.
