# Upload to POS workflow review

Reviewed 13 September 2026 against the current catalog source and deployed backend receiving rules. This is a source-level flow audit, not an observed usability session. No application behaviour or production data was changed for this review.

## Finding

The interface exposes implementation tools as competing workflow steps. A basic operator must understand preparation, stock-count confirmation, product matching, destinations, pricing, and receipt separately. The required business journey should instead be upload → AI fill → price → summary → send to POS.

## Evidence from the current flow

| Location | Current behaviour | Effect on an operator |
| --- | --- | --- |
| Receiving selection toolbar | Prepare selected, Choose destinations and Receive selected are all primary buttons; Price, AI fill and Match product also appear | Several equally prominent choices with no clear sequence |
| Receive selected | Users with POS-product access are sent to ProductDestinations; other publishers go directly to receipt review | The same button has different next steps based on permissions; its label does not describe the action |
| Next-task status | Missing name, then unconfirmed stock breakdown, then selling price, then cost | A successful AI fill leads to Count sizes rather than the logical pricing step |
| Bulk preparation | Separate save-details, count confirmation, readiness refresh, exception tools, pricing and receive actions | Repeated confirmation and tool-switching instead of completing one batch task |
| Preparation → receive | Opens destinations; destinations can send users back to preparation | Circular navigation |
| Destinations | Mandatory explicit selection between restock, photo/details-only update and new product; another modal reviews and saves the decision | Exposes catalog-management concepts and a no-stock operation in a stock-receiving journey |
| Pricing | Separate retail/cost tabs, fill/revise intent, rule controls, preview/save, success dialog and return to Receiving | The operator must remember that saving prices does not complete receipt; advanced repricing tools dominate first-time pricing |
| Receipt summary | Already largely read-only, but contains matched-group terminology, exclusions and buttons into preparation/editing | The last screen becomes another troubleshooting hub instead of a simple confirmation |
| Suggestions | Saved-data matching suggestions require explicit review/confirmation; destination rankings are display-only | The current implementation is not automatic matching; hiding these screens alone will not implement automatic resolution |

Source locations: `app/components/receiving.tsx`, `bulk-preparation.tsx`, `product-destinations.tsx`, `pricing.tsx`, `suggested-matches.tsx`, and `app/app/page.tsx`. Backend requirements were checked in the deployed-source copy of `backend/src/services/catalogPublicationService.js`.

## Proposed standard journey

### 1. Upload

Keep the existing successful upload experience. The delivery and branch remain visible throughout the journey. Upload retries and duplicate-upload protection remain intact.

### 2. AI fill

Keep the current batch AI operation. On completion show one primary action: **Price items**. Preserve the delivery and selected items when moving forward. If only some AI jobs finish, clearly identify those still processing without moving or losing the completed selection.

### 3. Price

Use a delivery-focused page, not the full repricing workspace. Show photo, name, size, quantity and selling price on the same rows. Show required cost alongside price for authorized users. Support a shared price/cost/quantity applied to selected rows and quick exceptions inline.

Populate sizes and quantity suggestions from saved extraction. A default of one must be labelled as a default; it is not a verified count. There is no separate mandatory Count sizes screen or count-confirmation modal. The final send confirms the displayed quantities for the batch, with fresh server validation and an audit record. Never infer stock quantity from a size number or silently manufacture missing sizes.

One primary action: **Review for POS**. A required missing value is highlighted here with a direct route to the affected rows. Technical issues should use plain descriptions, such as “Category setup needed,” rather than exposing internal mapping operations. A bulk correction must be available for repeated missing fields.

Costs need explicit treatment: the current backend requires a cost for every variant, but users without cost access do not see cost entry. Retaining that rule means costs must be available from an authorized batch setup or entered by an authorized operator on this page. Do not promise that every basic user can complete receipt while leaving an invisible cost requirement. Making cost optional would be a separate business-policy change, not a UI cleanup.

### 4. Summary

Read-only, with photo/name, sizes, quantities, selling prices, total items/units and destination branch. Show “New product” or “Added to existing product” as a simple outcome, not a required choice. Costs remain permission-controlled.

Only two actions: **Back to pricing** and **Send to POS**. Back preserves selection, edits and scroll context. No inline editors, destination chooser or nested preparation modals. Identify any excluded items and the actual number being sent explicitly; do not silently send only part of what the operator selected.

### 5. Send to POS

Validate prices, sizes, quantities, category setup and the exact review revision on the server. Confirm quantities and publish through one user action; implementation must protect against partial completion and duplicate stock on retry. Preserve existing branch authorization, matched-group integrity, publication idempotency, receipt recovery and audit history.

Success reads **Sent to POS: N items / N units**, with **View in POS** and **Upload more**. A failure keeps the remaining items and explains which succeeded; never ask users to start the delivery again.

## Automatic product handling

- Reuse existing confirmed product links and complete matched groups in the background.
- Automatically link/group only on a unique, validated product identity with compatible category/variant evidence. An AI confidence label or similar colour/name is insufficient to merge stock.
- Proposed fallback when no reliable identity exists: create a new product through the standard send action. No forced matching or destination-choice step. This can leave duplicates; expose them to a separate supervisor reconciliation queue rather than guessing an existing target.
- Optional matching discovery failures must not block pricing or receipt. A broken previously confirmed link is a genuine exception and must not silently be replaced with a new product.
- A photo/details-only update is a separate user intent and belongs outside stock intake. Its source-archival behaviour must never be reachable by accidentally choosing an unfamiliar action during receipt.

The fallback-to-new policy is part of the proposed design for approval; this review has not enabled it or changed any existing product links.

## Separate advanced workspace

Move manual matching/unmatching, product destinations, photo-only updates, category mappings, detailed variant/count editing, complex price rules, repricing, cost history and reconciliation to **Advanced tools**. Preserve these capabilities; mark current main-flow entry points as relocation candidates rather than deleting the features. Keep the standalone Pricing workspace for power users who intentionally reprice existing stock.

Optional metadata uncertainty should not block receipt. Audit configured required fields separately so purely descriptive fields do not become hidden mandatory work. Genuine missing commercial/stock data still needs correction, but that correction must be visible and bulk-capable on the pricing page.

## Acceptance criteria for implementation

1. After AI fill, the delivery has one primary action: Price items.
2. After entering valid prices and any required costs, the primary action is Review for POS.
3. A normal delivery never opens Prepare, Match, Choose destinations or Confirm counts modals.
4. Unknown product matches do not prevent an otherwise valid delivery from being sent.
5. The summary is read-only and the branch, prices, sizes, counts and any exclusions are clear.
6. Going back, refreshing or changing steps preserves the delivery context; unsaved edits remain protected.
7. Shared prices and counts can be applied in bulk; exceptions do not force one-by-one review of the entire delivery.
8. Uploading a later image does not accidentally add stock through a photo-only update, or update metadata through a stock receipt.
9. Sending twice, losing the connection or retrying a partially completed send cannot duplicate stock.
10. Existing advanced tools and permissions remain available and tested outside the standard journey.

## Implementation boundary

This requires coordinated frontend and backend changes. Merely hiding buttons would leave the mandatory human-confirmed count rule and explicit destination workflow underneath. Implement a delivery-focused pricing path, automatic destination planning with the approved fallback, and final batch count confirmation/publication, then verify normal deliveries, ambiguous matches, missing costs, partial failures and retries. Deployment remains a separate approval step.


## Implemented after approval

Implemented the simple journey with a dedicated pricing page and read-only receipt summary. Technical actions and the old pricing workspace are reached through Advanced tools. The primary flow no longer asks for preparation, destination or separate count confirmation. Existing confirmed links are used; new unlinked items create new products. Quantity suggestions, missing required details and prices are visible together before receipt. Existing target prices are preserved and shown in the summary.

The final send confirms quantities inside the same database transaction as the existing POS publication engine. Signed snapshots reject stale edits and target-price changes. Confirmed groups are selected together; partial group review is rejected. Successful items remain sent after partial failures, and retries use the original signed summary. Photo handoff failures are reported separately from stock success. Browser drafts are scoped to operator, branch and selection and restored only against unchanged server revisions.

Checks: local PostgreSQL API integration, existing product-matching regression, deterministic desktop/mobile UI flow, TypeScript and production Node build. Evidence: `verification/delivery-checkout-api.json` and `verification/delivery-checkout-ui.json`. No hosted stock was changed. Deployment and commit remain separate approval phases.
