# Background AI Fill

Status: implementation approved and completed locally. Integration, browser-closure, restart-recovery and regression checks passed. Deployment approved and completed on 9 September 2026. See [release review](background-ai-fill-release-review.md).

## Problem and intended behavior

The current `app/components/ai-fill.tsx` sends one extraction request at a time in a browser loop. The server persists individual outcomes through `CatalogAiRun`, but it does not own the remaining selected items. Suspending or closing the browser can therefore stop the batch.

After this change, pressing Fill submits the selected item IDs once. Once the server acknowledges the batch, it continues independently of the device. Receiving shows a saved progress summary and lets staff reopen the batch after refresh, sign-in, or returning on another device with the appropriate branch permissions. The interface must distinguish submitting from accepted background work; photographs must already have finished uploading.

## Implementation scope

1. Add branch-scoped batch and batch-item tables through an additive migration. Store the requesting user, client submission key, ordered membership, durable state, timestamps, attempt linkage, and safe failure messages. Use a unique submission key and active item reservation to prevent repeated clicks, lost acknowledgements, or overlapping selections from creating duplicate work. Keep historical outcomes.
2. Add authenticated submit, list, status, stop, and explicit resume/retry endpoints under `/catalog-workspace/ai-batches`. Require existing catalog view/edit permissions and active branch access. Validate every selected item atomically at submission; recheck eligibility and the requesting user's effective permissions before execution. Do not persist browser bearer tokens.
3. Run a database-backed worker with one active extraction at a time initially. Multiple application instances must coordinate claims in PostgreSQL. Persist ownership and attempt linkage before contacting the provider, and fence completion writes so an abandoned worker cannot overwrite a later decision. Start discovery of queued work on server startup; stop taking new claims on graceful shutdown.
4. Reuse the existing extraction service, fill-empty behavior, caption/category guidance, audit records, and durable hourly/daily usage caps. Keep the existing single-photo endpoint compatible and enforce the same active-item reservation across both paths. This requires a small host-backend integration change as well as the workspace package.
5. Replace the browser extraction loop with batch submission and status display. Show Queued, Reading, Done, Needs attention, and Stopped counts. Poll while visible and refresh immediately when returning online or to the foreground. Closing the dialog must be safe. Add a Receiving progress entry so recovery does not depend on remembering and reselecting the original lots.
6. Refresh merchandise and suggested matches when new saved results arrive. Group confirmation and stock receipt remain explicit, separate actions.

## Stop, failures, and recovery

- Stop prevents the next queued photo from starting; the current request may finish and save its result. Stopped work remains available for explicit resume.
- Server restart resumes photos that definitely have not started. A completed linked extraction is reconciled without another provider request.
- A request with an uncertain provider outcome is marked Needs attention and reconciled against the saved attempt/job record. Do not automatically repeat a potentially paid extraction or promise exactly-once provider billing. Staff must explicitly approve a retry where the outcome remains unknown.
- Pause the batch on usage limits, provider outages, or uncertain attempts. Preserve remaining photos and explain the reason; do not repeatedly consume requests in the background.
- Skip already-completed, received, or cancelled items with a visible explanation. Stop work when the original requester is inactive or no longer has the necessary branch/edit access.
- Signing out or locking the device does not cancel accepted work. Make that behavior clear next to the start and stop controls.

## Verification before deployment

Use the dedicated local test database and a stubbed external provider, with real application authentication, extraction persistence, and worker logic. No production photos or paid model calls are needed for these checks.

- Submit several photos, close the browser immediately after acknowledgement, and verify that the remaining photos complete; reopen in a new session and verify saved progress and field values.
- Disconnect during submission and repeat with the same submission key; confirm one batch and no extra provider calls.
- Restart the worker before execution, during a request, and after result persistence but before batch bookkeeping. Verify queued recovery, uncertain-attempt handling, and reconciliation without duplicate inference.
- Run two workers and overlapping submissions, including the old single-photo endpoint. Verify one owner per item and no competing writes.
- Verify stop/resume, usage-limit pause, provider failure, cancellation/publication while queued, permission revocation, and cross-branch isolation.
- Verify existing nonempty details and confirmed stock counts remain protected, and that completed fills refresh saved-data matching suggestions.
- Run appropriate API/browser regressions, typecheck, lint, and production builds. Record results and package exact reviewed source for deployment approval.

## Release boundary

Implement and test locally first. Deployment is a separate phase: back up the database, apply the additive migration through the existing guard, deploy the compatible backend/worker, then deploy the catalog interface. Keep the current extraction model unchanged. Do not commit without the owner's confirmation.

The supplied AGENTS.md preference states: “Always wait for my confirmation before proceeding to the next phase.” Implementation and deployment were separately approved and completed.
