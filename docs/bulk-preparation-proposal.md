# Bulk merchandise preparation proposal

Status: implementation approved and completed locally; verification passed. Deployment awaits owner confirmation. See bulk-preparation-release-review.md.

Owner requirement: no mandatory preparation step may force opening each product separately. One-product review remains optional. Staff must be able to complete an entire selected delivery from batch screens.

## Findings

The receiving selection toolbar provides Price, AI fill, Match product and Receive selected into POS. It has no bulk count-confirmation action or general bulk details editor. The count filter only filters the list. Count confirmation exists solely inside the individual draft editor. Recorded label sizes are separate from variant size rows, leaving reviewed shirts with blank variant sizes and intake-default quantities.

Actual receiving blockers include missing names/photos, unresolved flags, category mapping, unconfirmed counts, required category attributes, selling prices and costs. Matched groups have their own identity/readiness validation. These need batch resolution routes; deleting quantity or required-data checks would not supply missing stock information.

## Approved-direction workflow to implement

Select all products in the filtered delivery, across pages. Open Prepare selected. Present a batch table containing image, name, saved label size, editable size rows, quantity, confirmation state and remaining requirements. Multiple sizes can be entered inline without opening a product dialog.

Prefill a missing single-row size from a single unambiguous saved label size, presented as a proposal. Keep all confirmed distributions unchanged unless staff explicitly select them for editing. Never spread one quantity across multiple inferred sizes. Offer explicit actions to set a common quantity per photographed lot, use one unit per lot, or accept displayed proposed counts for the selected lots. Show total source lots and total physical units before a single batch confirmation. Do not infer that multiple photos necessarily represent distinct physical stock.

Bulk details supports category, brand, shared attributes and a batch table for names or item-specific values. Only explicitly selected fields change. Required identity and material differences in matched groups remain visible and resolvable within the batch workflow. Category mappings are resolved once per category. Problem flags have a batch resolution action with the reason and affected lots visible. Photo problems have a batch retry/attachment route with clear per-lot association; no requirement to open individual editors.

Reuse existing bulk prices and costs. Each successful batch step refreshes readiness and offers the next batch action. Receive ready products together; unresolved exceptions stay in the batch table and do not prevent other ready products from progressing. Do not force staff to inspect every row or click an individual approval.

## Validation and delivery

Enforce current permissions, branch scope and stale-revision checks. Keep writes auditable. Return a result for every selected lot so retries do not repeat successful operations or overwrite concurrent changes. Preserve existing prices and received quantities. No preparation action receives stock automatically.

Test an entire multi-page delivery from count confirmation through pricing and receipt without opening any individual editor; mixed sizes and quantities; shared Cotton/Short sleeve edits; partial errors and safe retry; concurrent edits; preserved confirmed counts; matched groups; mobile batch entry. Phase 1 implements and verifies the batch paths for all mandatory preparation requirements. Deployment is a separate owner-approved phase.
