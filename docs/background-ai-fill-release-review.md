# Background AI Fill release review

The selected-photo AI Fill workflow now submits durable batch intent once. After acceptance, the server advances photos independently of the browser. Receiving exposes Background AI fill with saved progress, stop/resume, and review links. A new sign-in can discover batches without the original selection or local browser state.

## Changes ready for deployment

- Workspace package 0.23.0 adds authenticated, branch-scoped queue APIs and a production worker. The worker processes one photo globally at a time across instances; a 2-minute lease, refreshed every 10 seconds, identifies interrupted work. It wakes every 2 seconds and stops taking claims on shutdown.
- Additive POS migration 113 creates batch and item state with unique submission keys and active-item reservations. One submission accepts up to 1,000 distinct items; one requester can retain up to 10 unfinished batches. Stopped batches retain their queue reservations for resume.
- The host extraction integration applies the same reservation to the existing single-photo endpoint. It links the actual AI attempt before provider access, fences expired or superseded work, and commits saved fields and queue completion together. It also prevents an in-flight result from modifying subsequently cancelled intake. Queue acceptance fails safely if the compatible host integration is missing.
- The interface distinguishes an unconfirmed submission from accepted work. Repeating a submission after a lost acknowledgement uses the same key. Progress refreshes when returning to the foreground, reconnecting, and while the page is visible. Saved completions refresh merchandise and model-match suggestions.

The existing extractor model, prompt, fill-empty rules, provider-level retries, and durable usage caps are reused. This release does not improve model transcription accuracy or change stock receipt. The single-photo action in the details editor retains its existing request/reconciliation flow; selected-photo AI Fill uses the new background queue.

## Recovery behavior

Completed requests are not automatically sent again. Unstarted queued photos can resume after a worker restart. If a worker dies after starting a provider request, the attempt becomes Needs attention after its lease expires. Staff must review saved details and explicitly consent to a potentially paid retry. Usage limits and provider failures pause the remaining batch. Stop allows the claimed current photo to finish and preserves the remainder for resume.

Permission and active branch access are checked again for the original requester before work starts. Deactivation or revoked edit access pauses the batch. Cancelled, received, already-filled, or unavailable photos are skipped. No browser token is stored in the queue.

## Validation completed

- Real local PostgreSQL and production authentication: idempotent acceptance, duplicate/overlapping selections, old endpoint reservation enforcement, branch isolation, two workers, stop/resume, human-field/count protection, provider failure, explicit retries, usage limits, user deactivation, permission revocation, and publication/cancellation after acceptance.
- An actual child worker process was terminated during its provider call. Recovery preserved unstarted photos, required consent for the uncertain attempt, and rejected a late result. A claim interrupted before attempt linkage returned safely to the queue. A simulated loss of worker bookkeeping after result persistence did not repeat inference.
- Browser test: lose the batch acknowledgement, recover acceptance, pause on a fixture provider outage, explicitly retry, close the entire browser, and verify that both photos finish server-side. Sign in through a fresh browser session and reopen progress from Receiving. The 360-pixel mobile progress view was inspected visually and had no page overflow. Existing AI evidence review, manual correction, physical counts, and single-photo lost-response reconciliation passed.
- The actual packaged backend mount passed the queue integration suite. Existing matching, grouped stock/gallery rollback and retry, workspace pricing, receipt, sale and branch-stock regressions passed sequentially. Generic local photo-handoff failures remained expected without the production object store; the dedicated gallery fixture passed independently.
- Typecheck, lint, production Node build, and whitespace checks passed. Provider calls used a deterministic local test substitute: no paid AI calls or production merchandise changes were made.

Evidence: `verification/ai-batches-integration.json`, `verification/ai-fill-browser.json`, `verification/ai-batch-mobile.png`, and the package/source hashes in `verification/background-ai-release.json`.

## Deployment and rollback

The prepared POS snapshot is `.test-data/background-ai-pos`; it starts from the deployed POS base plus package 0.22.0/migration 112, then contains only the reviewed queue integration, package 0.23.0 and migration 113. It excludes unrelated edits from the sibling POS checkout. The prepared catalog snapshot is `.test-data/background-ai-catalog` and preserves the current deployed category selector and suggested matches.

After approval: verify source hashes and current production migration state, make and inspect a fresh database backup, apply migration 113 through the existing production backup guard, deploy the compatible backend, verify health, then deploy the catalog. Inspect authenticated live progress without launching paid test batches or changing merchandise. Do not commit without separate confirmation.

For a frontend rollback, retain the compatible backend so accepted batches and reservations remain recoverable. For a full rollback, stop accepting new batches and let or explicitly stop/reconcile accepted work before reverting the worker/host integration; do not drop queue tables or discard saved outcomes. Deployment was subsequently approved and completed; no Git commit was created.

## Production verification — 9 September 2026

Backend `b0be3f0f-0c72-4478-b75d-f5775675f707` and catalog `be993f5f-a30f-463c-b86c-b43c093b7236` both succeeded. The API returned OK. Migration 113 applied after a readable 2,211,962-byte backup; all migrations are tracked with no pending changes or checksum drift.

The signed-in live catalog displayed Background AI fill (0 unfinished) and loaded its no-batches guidance without an API error. Existing suggested matches remained available (nine in Ntinda). Checked backend logs contained no background-worker errors. No paid production batch was launched and no merchandise was modified during verification. Browser closure and restart recovery were validated locally before this release.
