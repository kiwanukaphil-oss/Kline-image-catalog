# Original app parity assessment

Updated 7 September 2026 against the active Railway PWA in
`C:/Projects/Images/Inventory image database` and the live POS data. This replaces
the earlier inventory whose open implementation items have since been completed.
The production execution checklist is in [production cutover](production-cutover-plan.md).

| Original capability | Replacement / remaining difference |
|---|---|
| Uploaded images, metadata, costs, size lines, evidence and history | Reuse the exact live POS database and private bucket. Preserve IDs, original object keys and history; no duplicate import. |
| POS login, permissions and branch choice | Same identities and permissions. Only admin currently has active catalog access; staff-account decisions are pending. |
| Gallery, review and upload navigation | Receiving, Pricing and Stock are separate workflows. Existing ungrouped merchandise opens immediately instead of appearing to be an empty catalog. |
| Category fields, review flags and readiness | Implemented, with typed fields, explicit photo holds and receiving blockers. Historical saved choices remain visible; unchanged attributes survive unrelated edits. |
| AI fill, evidence, confidence, retry and activity | Implemented with explicit selection, saved-job recovery and review; quantities require separate human confirmation. Two real-photo staging checks pass. |
| Physical size/quantity confirmation | Implemented; drafts never inflate POS stock. |
| Shared prices, variants, exceptions and Undo | Implemented with exact reviewed changes, persisted history and conditional Undo. Both requested 1,000-item examples pass. |
| Publish into POS / live stock | Reviewed, idempotent receiving and explicit existing-product restock. Already-published records remain protected; current stock comes from POS. |
| Search/facets/order | Task/category/search/sort in Receiving; brand/size/category selection in Pricing and Stock. Old combined gallery date/price facets are not copied as a second overlapping workspace. |
| Item activity and photo inspection | Implemented with paginated activity, zoom/fit and independent image recovery. |
| All-branch read overview | Per-branch Stock is implemented. A combined all-branch screen remains an optional difference. |
| Restart-safe queue, camera, burst capture, large photos, duplicate warning | Implemented. Unsent photos still held only by the old browser must finish there before its origin is retired. Uploaded server images require no move. |
| Upload Undo / correction | Audited reversible cancellation, including stable queued IDs; received stock is protected. |
| PWA install, share target, offline/update handling | Implemented and browser-verified. Physical store-phone camera/OS acceptance remains a human check. |
| Categories, fields, mappings and POS administration | Implemented. Three pre-existing mapping gaps affect Jeans, Shorts and Sweat pants; see the cutover plan and requested category decisions. |
| Light/dark appearance and accessibility | Implemented; eight automated accessibility views passed. |
| Vocabulary autocomplete | Historical vocabulary data is preserved. The current old-app backend already returns an empty vocabulary list; this is not a newly removed feature. |
| CSV, general bulk editing and legacy user/deletion controls | Some are README claims or masked source controls, not established reachable production capabilities. Retain source; do not claim a CSV importer is needed for records already in the same database. |
| Local folders, spreadsheets and retired-provider archives | Preserve as reconciliation/rollback evidence. No deletion or provider-account cancellation is part of replacement deployment. |

The material cutover work is data-preserving backend enablement, category/access
configuration, production upload verification and the replacement address.
The two migration-specific interface issues have focused browser checks in
`verification/migration-interface.json`. Data integrity/backup evidence stays in
private local reports. Feature implementation does not certify staff usability,
physical-phone quality or an unattended monitoring arrangement.
