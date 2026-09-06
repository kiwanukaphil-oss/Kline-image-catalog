> Status: design direction approved on 6 September 2026. The original proposal below is retained as design history. See the root REVIEW_BRIEF.md for implementation status.

# K-Line: from photographed stock to ready-to-sell inventory

Design review · 6 September 2026 · Proposal, not an implementation or release

## Purpose and evidence

K-Line is a visual stock preparation and monitoring workspace for a menswear retailer. Staff photograph merchandise, identify it, confirm sizes and physical quantities, enter prices and costs, and authorize receipt into the correct POS branch. They also use the app to see current stock, size availability, low stock, and recent stock movements. Photographs remain evidence; a photographed lot can contain several sizes and many units. After publication, POS owns sellable stock and prices.

The strongest foundation is already present: recoverable intake, protected AI suggestions, normalized size lines, separate cost permissions, reviewed pricing transactions, and publication that can be retried without duplicating stock. Preserve these behaviors while replacing the interaction design.

This review inspected the active catalog source, pricing and readiness helpers, upload and navigation code, test scenarios, and the adjacent POS catalog API, read model, publication service, and ADRs 069/071. Historical redesign documents were checked against current code. Their Supabase, one-photo-one-unit, and shop-mirror descriptions no longer describe the active application. A fresh browser context reached the current production username login; authenticated production workflows were not exercised. An existing browser context initially displayed an older cached login. Neither context was used to change inventory.

This is a source-based product assessment, not an observed staff usability study. The interactive concept uses historical product photos and explicitly invented quantities and prices. It has no backend connection. Its receiving groups, live POS catalog, and editing screens are proposed capabilities, not evidence that those capabilities exist today.

## What is causing the confusion

| Finding in the active app | Consequence | Design response |
|---|---|---|
| Home, Catalog, Review stages, issue filters, quick actions, and selected-item menus expose overlapping work. | The user must understand the application taxonomy before choosing a task. | Three persistent destinations: Receiving, Pricing, Stock. Put each job in one predictable place. |
| Pricing opens as a large overlay with rule/group modes, merchandise predicates, retail policies, only-missing scope, costs, overrides, overlap policy, and preview. | Even a simple price requires interpreting a pricing engine. | Start with actual merchandise and editable prices. Reveal exceptions only on request. |
| General edit access is deliberately masked in `buildRailwayCatalogProfile`; the active evidence sheet displays name, category and attributes as read-only. | “Missing details” can send users to a screen where they cannot finish the job. | Deliver a real field-correction API and editor as part of Receiving. |
| Client readiness and server publication validation differ: confirmed quantities and POS category mapping are enforced in publication but not equivalently in the generic readiness helper. | “Ready” can become an error at the final action. | One server-derived readiness contract feeds every queue and final review. |
| Published catalog reads still summarize staging quantities/prices; the old mirror adapter returns empty structures. | Historical intake values can be mistaken for current shop availability. | Stock reads current POS values and shows freshness. Receiving retains historical receipt quantities. |
| Publication creates POS products/variants and stock movements, but does not copy catalog imagery to POS product images. | A visually rich intake can still produce a visually poor POS listing. | Add a supported image handoff with durable product linkage and visible recovery. |
| Bulk publication loops through individual items, although each item is transactional. | A batch can partly succeed. A brief toast is insufficient for reconciliation. | Persistent per-item publication receipts, with retry of only unresolved items. |
| Upload exposes internal statuses and repeated AI, branch and defaults explanations. | Users configure system mechanics rather than record merchandise. | Stable branch context, a simple capture surface, and contextual feedback beside the affected item. |

## Proposed product structure

**Receiving** is the working inbox. Show recent deliveries or capture sessions with a photo strip, date, physical unit count, and next unfinished task. The primary action is **Add stock**. Open a delivery and work within it: Details, Quantities, Prices, and Ready for POS. These are accessible sections, not a compulsory wizard. Staff can price first when they know the price, pause, or hand work to a colleague without losing the delivery context.

Use a persistent receiving batch identity, not just a client-side filter by upload date. A batch groups work; it does not assert that similar products are identical or merge photographed lots. Historical items appear under an honest “Earlier imports” group unless provenance establishes a real delivery. Optional supplier/reference information belongs in batch details and should not slow down capture.

**Pricing** is a visible destination with three task tabs: Unpriced, Change prices, and History. The first opens real unpriced merchandise, grouped by category by default. Staff can change the grouping to brand when useful. Costs are an independent, permission-controlled task within Pricing; missing costs must not disappear merely because retail prices are complete.

**Stock** replaces the narrow Catalog destination. It is a photo-led view of current POS inventory, including products created directly in POS. Search by name, SKU, barcode or brand, and filter by category, size and availability. Each product shows its current selling price or range, current branch quantity, and useful size-level exceptions. Low stock and out-of-stock views are directly accessible. Receipt history and unfinished items remain in Receiving.

Desktop uses a restrained side rail and a spacious working area. Mobile uses the same three destination names in bottom navigation, with Add stock as an explicit action inside Receiving. Hide unauthorized actions, and retain a concise handoff status when a different role must complete the task. Stock viewers can land in Stock; receiving staff can resume Receiving. Adding monitoring does not require a fourth dashboard or another generic Review destination.

## Monitoring current stock

Stock answers concrete questions: “Do we have waist 34?”, “Which sizes need replenishment?”, and “Why did this count change?” Its initial view is merchandise with availability, rather than a collection of summary cards. Keep the active branch visible; authorized users can switch branches or inspect a branch breakdown. An all-branch total must not imply that those units are available at the selected shop.

Open a product to see one line per sellable variant: size/colour, current quantity, current unit price, and stock state. Show recent receipts, sales, returns, transfers and adjustments from POS movement records, with date, branch, quantity change and resulting balance. Preserve signed quantities; negative inventory is a discrepancy to resolve, not zero stock. Do not treat a missing response as a zero count.

Use the configured POS reorder level for each variant/branch when available. Missing thresholds mean “Not configured,” not an invented low-stock rule. Surface a low size even when the overall product has plenty of other sizes. Size filtering narrows the displayed quantities and counts to that size. Product totals and size availability must never contradict each other. Distinguish on-hand and available-to-sell only if the POS supplies separate definitions and values; do not invent reservations or subtract them speculatively.

The Stock read model must start with the POS product and variant identities, joining linked catalog imagery and evidence. Separate photographed lots may link to the same POS variant over time; sum stock from POS once, never once per photo. Products without a catalog photo remain searchable with an honest image placeholder. Published items from this app become visible after an authoritative POS refresh.

Freshness belongs beside the stock result: last successful update, refresh action, and a concise stale/offline state when relevant. Refresh on screen entry, on return from POS actions, and at a documented interval while visible; event-driven invalidation can improve latency if supported. Never imply that a stale snapshot is live. Branch-scoped, permission-safe caching must not leak quantities or costs across users or branches.

Stock monitoring is read-only by default. “Change selling price,” “Adjust stock,” and “Transfer” open the authorized POS workflow with product, variant and branch carried through. “Receive more” opens Receiving against an explicitly matched existing product. A new delivery cannot be silently merged by photo, name or brand. Historical receipt counts remain available from Receiving and product provenance, clearly labelled as historical.

The updated interactive concept illustrates stock search, low/out-of-stock filters, size filtering and a product availability/movement view with sample POS data. It does not claim that a live POS read, refresh subscription or cross-app action has been implemented.

Settings, category configuration, field definitions, permissions, and technical integration diagnostics belong in administration. Quick actions can remain as an optional shortcut, never the only visible way into core work.

## Receiving, step by step

1. **Capture.** Branch is already selected and visible. Take a photo or choose several. Keep burst capture inside the camera experience. Choose a category once when the API needs it; support mixed-category batches through an explicit per-item correction. Additional label/detail photos attach to the same lot rather than accidentally creating more stock; this needs a new attachment contract.
2. **Identify.** AI can fill empty fields in the background under the existing permission and usage policy. Present usable product names and fields immediately. Highlight only unresolved or uncertain fields. Evidence is available on demand beside a field. A failed AI attempt has Retry and manual completion; AI success must not be a prerequisite when a human has supplied valid data.
3. **Count.** The item shows a small size/quantity table. Confirm actual units explicitly, including the single-unit default. Never infer physical stock count from the number of pictures. Photos and sellable lines remain linked but distinct.
4. **Price.** Enter a price here for a one-off item, or open the batch in Pricing with selection preserved. Costs can be completed by an authorized colleague. Saving an incomplete draft is legitimate; receiving it into POS requires complete, validated coverage.
5. **Receive into POS.** Show the destination, products, sizes, units, and prices in one final review. The action clearly means both approval and stock receipt. After success, show the durable receipt and links to the created POS products. Partial success stays as a resolvable list; never report the entire batch as received when only some items succeeded.

Item status should answer a business question: Preparing, Ready for POS, Received, or Needs attention. Display one next task beside an item, with all unresolved requirements accessible inside it. Task filters may overlap, but overview counts must not imply that overlapping work counts add up to a unique total. “Recently edited” is history, not a lifecycle stage.

## Pricing that starts with a price

The normal operation is **choose merchandise → enter prices → review → save**. When Pricing is opened from a receiving batch or selection, keep that exact scope. When opened globally, show the Unpriced queue rather than silently targeting every unpublished item.

The initial working screen contains the scope, product thumbnails/names, quantities, current prices, and price inputs. Selecting several rows reveals **Set one price**. Otherwise, enter different prices directly per row. The right-hand preview on desktop is the same merchandise table, not a competing visualization of the rule system. On mobile, expand a product into its size rows and keep the final action reachable.

**Example:** one photographed trouser lot contains waist 30 × 1, 32 × 2, and 34 × 3. Enter UGX 90,000 once. If waist 34 needs a different price, expand Sizes and enter UGX 100,000 for that row. Review shows three size lines, six units, and the exact old/new prices. Quantity affects the total stock value; it does not multiply the unit selling price entered into a field.

The Unpriced task changes only missing effective prices. An inherited price is already a price. A product with two priced sizes and one missing size exposes just that remaining gap as editable work. Change prices is a separate intent: show existing values, permit explicit row edits, and retain individual size prices unless the user includes them. A size-only selection cannot change sibling sizes or the parent default.

Costs have their own editable table or collapsed authorized section, with independent fill/change intent. Missing cost means unknown, never zero. Show only a permission-safe “Cost needed” handoff to other staff. Do not force users to change retail and cost together.

**Advanced pricing:** reusable category/brand/material price lists may be useful, but are not the entry screen. Provide a clearly named Price lists tool if the business uses repeatable policies. Applying a list produces a reviewed draft. It must not silently become continuous automatic repricing of future stock. Conflicting matches need a visible resolution on the affected merchandise; rule order should not be a global checkbox every ordinary user must interpret.

Keep the existing authoritative preview/apply/receipt/conditional-undo foundation. A simple input surface should compile into that same plan contract. Blank inputs mean unchanged; “Use shared price” explicitly removes a size exception. Save prices never publishes stock. Stale reviews must refresh before applying. History shows what changed, who changed it, and whether undo is still available.

## POS integration as a complete handoff

| Concern | Proposed ownership and experience |
|---|---|
| Identity and access | Existing POS identities, effective capabilities, and branch access. No second user directory. |
| Draft stock | Catalog owns unpublished photographed lots and confirmed draft quantities. They are not available to sell. |
| Published stock and prices | POS owns current values. Stock consumes an authoritative branch/variant read with freshness; Receiving retains immutable receipt quantities. |
| Images | Keep private evidence originals. Create/link a suitable durable POS product image through a server-owned contract; never persist an expiring signed URL as the product image. |
| New delivery of an existing product | Offer explicit “Receive against existing product” with variant matching and confirmation. Current publication creates a new product; do not assume SKU similarity authorizes a merge. |
| Product correction | Draft corrections stay in Catalog. Published commercial changes use POS. Clearly distinguish evidence annotations from commercial edits. |
| Category mapping | Resolve mappings in administration and expose an actionable blocker before final review. Do not make staff guess from a failed publication request. |
| Recovery | Store publication outcomes, reconcile uncertain timeouts, and retry unresolved items. Show image handoff failures without duplicating inventory receipt. |
| Multi-branch | Always name the write destination. All-branch browsing cannot authorize a multi-branch price or stock mutation. |

Do not recreate POS sales, returns, transfers, or accounting screens in this app. The catalog should make the connected POS easy to reach with context. A single front door and shared session experience are desirable, but need deliberate cross-application authentication design; sharing credentials in storage is not a design solution.

## Visual direction

Proposed direction: a quiet contemporary retail workspace. Warm neutral surfaces, clear charcoal type, subtle separators, generous product photography, and a deep ink-blue action color. Dark mode uses the same hierarchy. No permanent instructional hero, gradient dashboard decoration, or stack of status banners. Important actions are recognizable from placement and wording.

Use readable type, tabular price digits, consistent spacing, and restrained corners. A product photo should have an intentional crop and a full-image view, including readable garment labels. Desktop density should support work rather than enlarge every phone card. Mobile controls need comfortable touch targets, keyboard-friendly money entry, safe areas, and a reachable save action. Do not use color as the only status signal.

Feedback belongs where it matters: invalid quantity beside that quantity, a missing field beside the field, upload progress on the photo, and publication failure on the receipt row. A compact global connection indicator is appropriate; explain its consequences only when a blocked action is attempted. App updates can wait until a task is safely saved.

The rationale is consistent with [recognition over recall](https://www.nngroup.com/articles/recognition-and-recall/) and [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): expose frequent actions clearly and move uncommon options behind specific, discoverable controls. The exact split must be validated with staff, not assumed from the principles alone.

## Proposed retirements and preservation

<!-- Removal candidates only. No existing code or feature has been deleted. -->

Candidates for retirement after equivalent workflows are verified: the general Home dashboard, separate generic Review destination, Fix/Verify/Approve navigation layers, repeated instructional banners, internal status selection during upload, and the old pricing overlay as the default entry. Preserve pricing rules, bulk work, confidence evidence, upload recovery, and audit history behind the new task structure. Retire code only after usage, parity and migration checks, with owner confirmation.

## Decisions and next phase

The owner expanded the scope to include monitoring current stock as well as preparing new stock. Similar items still share a price with occasional exceptions. Both Receiving and Stock are core destinations; continuous automatic pricing is not implied.

The revised structure is **Receiving, Pricing, Stock**. Keep deliveries and unfinished work together in Receiving, and present current POS inventory in Stock. The landing destination can follow the staff role or last-used workspace. The revised design direction still awaits owner approval before implementation.

After direction approval, complete a receiving-to-stock vertical slice: one receiving batch, editable product details, confirmed size quantities, simple pricing, authoritative readiness, a durable POS receipt, and current POS stock visible in Stock. Verify that a subsequent POS sale changes availability without changing the receiving receipt. Follow with broader stock filters, movement history, image handoff, restock matching, and optional reusable price lists. Current-stock monitoring is required scope. Choose implementation architecture after reviewing the approved interaction prototype; a framework rewrite alone will not resolve workflow ambiguity.

Acceptance should include: a first-time operator finds pricing without instructions; six units across three sizes receive exactly six units; a size exception preserves siblings; filling gaps preserves existing prices; non-cost users cannot receive cost values; interrupted uploads resume; stale edits cannot apply; a publication timeout cannot duplicate stock; partial batches remain recoverable; current POS availability is distinguishable from received quantity; keyboard and 360px mobile flows complete without clipped actions. Measure task completion and errors with staff rather than declaring the design intuitive from screenshots.

This phase changes design artifacts only. No source implementation, database writes, commits, or deployments are included.

Additional stock acceptance: a POS sale/return/transfer changes the correct branch and variant after refresh; received quantity remains historical; repeated photos do not multiply stock; POS-only products are searchable; a depleted size remains visible; low stock uses configured thresholds; missing data is not zero; negative stock is explicit; stale/offline results retain a timestamp; current selling prices come from POS; unauthorized branch and cost information never reaches the client.

## Source anchors

- [Active capability masking and navigation](</C:/Projects/Images/Inventory image database/src/lib/railway-catalog-ui.js:5>)
- [Active item details and actions](</C:/Projects/Images/Inventory image database/src/gallery.js:755>)
- [Pricing workspace](</C:/Projects/Images/Inventory image database/src/railwayPricingWorkspace.js:146>)
- [Client readiness](</C:/Projects/Images/Inventory image database/src/lib/readiness-core.js:153>)
- [Server publication validation](</C:/Projects/inventory-pos-system/backend/src/services/catalogPublicationService.js:71>)
- [Catalog reads from staging values](</C:/Projects/inventory-pos-system/backend/src/models/CatalogItem.js:64>)
- [Publication ownership and image boundary](</C:/Projects/inventory-pos-system/docs/decisions/ADR-069-catalog-variant-pricing-and-pos-publication.md>)
- [Reviewed price plans](</C:/Projects/inventory-pos-system/docs/decisions/ADR-071-reviewed-catalog-pricing-plans.md>)
