# Batch product destinations

Status: deployed with owner approval on 12 September 2026. Backend and frontend report SUCCESS and the backend health endpoint returns 200 OK. No commit was created. Deployment and verification did not change production merchandise.

## Result

Receiving has a **Choose destinations** batch screen. **Receive selected into POS** and **Receive all ready** now open this screen for staff with product-view permission. An unassigned upload starts with no action selected. Existing saved group choices remain visible.

Staff choose **Restock existing product**, **Update photos/details only**, or **Create new product on receipt**. Candidates show existing product photos, brand and variant attributes, with previously received branch products prioritised. Search and appearance ranking provide candidates, not automatic identity confirmation. Different rows can target different products in one reviewed batch. Common actions, product assignment and shared name/description values can be applied to the selection across pages.

Restock and new-product choices save grouping plans only. Counts, pricing and stock receipt remain separate bulk steps. Unmatched lots going to the same existing target are combined; pre-existing groups retain their shared colour/fit defaults and remain separate plans. Partial groups cannot silently be reassigned. Explicit new-product choices also support single-lot plans.

Photo/details updates support explicit product name, description and gallery additions. The review displays before/after details, the target and affected lot count. The POS product is shared across branches. Prices, costs, variants and stock remain unchanged. Original files and existing gallery/primary photos are retained. The source intake is archived using the existing reversible cancellation record, with the reason **Completed POS photo/details update ... no incoming stock**. It appears under **Archived / cancelled intake**, and its detail screen identifies the completed no-stock update. No publication or receipt is created. Restoration is an explicit existing intake action; it does not undo the POS update.

Each destination has its own transaction and result. Signed reviews cover actor, branch, sources, grouping and target state. Stale writes and uncertain retries require a reload rather than silently repeating operations. Updating POS details additionally requires `products.edit`, `catalog.edit` and `catalog.delete`; the destination workspace retains the matching permissions `catalog.publish` and `products.view`.

## Verification

- Real local HTTP/SQL tests passed different restock targets and new destinations, stale target changes, partial groups, permission enforcement, branch isolation, safe retries and no-stock gallery/detail updates.
- A prior primary photo and gallery entry survived the update. Source quantities and distribution confirmation states were unchanged, and the stock-movement count did not increase.
- A real browser test completed eight rows: two existing restock destinations, two explicit new-product destinations, and one shared photo/description update for two source lots. Saved stock continued into bulk preparation without individual editors.
- The full 52-lot preparation, count, pricing, destination and receipt journey passed, creating exactly 60 local POS units. Final verification uses bounded batch reads.
- Existing product-matching and integration tests passed, including new-size restocking, atomic group receipt, retry protection, sales and branch stock separation.
- Type checking, lint and Node production build passed. Desktop/mobile views were inspected and mobile bounds verified.

Evidence: `verification/product-destinations-api.json`, `product-destinations-browser.json`, `product-destinations-desktop.png`, `product-destinations-mobile.png`, and `bulk-preparation-browser.json`.

## Release

Deploy backend package **0.25.0** first, then the frontend. No database migration is needed. Include the new `server/product-destinations.cjs` and `app/components/product-destinations.tsx` files explicitly in the release snapshots, along with the changed router, service, matching code and frontend files. Preserve the deployed storage metadata fix and branch login gate.

No already-received product is merged or retargeted by this feature. Direct legacy item/POS workflows remain available. Product updates in this batch screen cover name, description and gallery additions; other product settings remain in POS. If a private-object copy succeeds but the SQL transaction fails, the deterministic unused object is a cleanup candidate, not deleted automatically, and can be reused by a retry.

## Existing NAMUGONGO shirts

The seven shirts were received after the grouping review. The new records therefore cannot be changed by editing preparation destinations. Visual comparison confirms the older navy, floral/paisley and white products match the corresponding new uploads. Candidate reconciliation pairs are recorded in `verification/received-shirt-reconciliation-review.json`. They require checking current balances, movement/sale references, price differences and barcode handling before an independently reviewed reconciliation. Production stock and receipt history remain untouched.

## Deployment verification

Live: https://klinemen-catalog.com. Backend deployment `cd660630-f679-4850-a7eb-6cf7fc2e5c69`; frontend deployment `930dde2a-9d88-4e4a-afca-56aa025c3d18`. The hosted destination screen passed the mixed eight-row workflow using isolated local API/SQL fixtures. The hosted branch gate passed all eleven regression checks using intercepted fixtures, including switching without signing out. These browser checks do not claim a production stock-write test. Evidence: `verification/product-destinations-release.json`, `verification/product-destinations-live-browser.json` and `verification/branch-gate-login-fix-live.json`.

## Subsequent owner-approved shirt reconciliation

After deployment, the owner requested linking the seven received shirts to existing products and confirmed keeping the three blue shirts grouped as they were. On 12 September 2026, navy 2XL (1), floral M (1) and white 4XL (2) were reconciled into their three older products. Existing variant IDs, SKUs, barcodes, prices, costs, stock rows and movements were preserved. Receipt, intake and photo links now point to the older products; original photos and primary images were retained. Cotton was carried into the target products. Empty duplicates were marked inactive with audit comments, not deleted. A transactional rehearsal and independent post-commit verification passed. Evidence: `verification/received-shirt-reconciliation-applied.json` and `verification/received-shirt-reconciliation-verified.json`.
