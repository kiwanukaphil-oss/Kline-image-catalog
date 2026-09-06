# Original capability inventory

Reviewed 6 September 2026 against `C:/Projects/Images/Inventory image database`. This inventory follows the deployed Railway entry point (`src/main.js`), the capability mask (`src/lib/railway-catalog-ui.js`), and the gallery/upload import graph. Historical source and README claims are distinguished from reachable controls. No removal is approved by this inventory.

| Original capability and evidence | Redesign disposition | Remaining work |
|---|---|---|
| POS username/password, effective permissions, branch choice (`auth.js`, `posbranches.js`) | Preserved through the same POS identity and branch middleware | Staging/session acceptance R12, I6 |
| Home, Catalog, Review, Add navigation (`gallery.js`, navigation mask) | Redesigned as Receiving, Pricing and Stock; New delivery belongs to Receiving | Staff acceptance A5 |
| Photo grid/list, selection, full image preview (`gallery.js`, `ui.js`) | Receiving rows and stock cards; zoom/fit photo inspection | No requirement to retain duplicate presentation modes |
| Category-driven fields, review flags, readiness (`data.js`, `readiness.js`, detail helpers) | Details editor, explicit photo hold, authoritative receiving blockers | Older-data cases D3 |
| AI fill, selected-item jobs, failures/retry, confidence/evidence (`catalogAi.js`, `bulkai.js`) | Explicit AI fill queue with persisted outcome checks and inline review | Real provider and abandoned-job recovery R11d |
| Physical size/quantity confirmation (`stock-distribution.js`, gallery editor) | Dedicated count action; draft quantities excluded from sellable stock | Real-device acceptance R12 |
| Variant pricing, review/apply/Undo (`railwayPricingWorkspace.js`, `railwayPricing.js`) | Shared price plus optional exceptions, exact review, durable history/Undo | Staff examples P12 |
| Publication and status (`gallery.js`, `railwayCatalogApi.js`) | Reviewed receiving into POS with durable receipt and independent image retry | Existing-product restock I3/I4; staging G5 |
| Search, category/attribute facets, date/price filters, task queues and sorting (`gallery.js`, `facets.js`, `itemsort.js`) | Stock and Pricing have relevant filters; Receiving currently has text/delivery selection | Receiving task/category filtering and sort remain R14; avoid silently dropping triage |
| Edited/AI activity badges and item history (`gallery.js`, `activity-labels.js`) | AI evidence, pricing history and receipt history preserved; detailed item-event timeline not yet surfaced | R15 |
| All-branch read view (`gallery.js`, branch scope helper) | Explicit per-branch Stock and authenticated POS links | All-branch aggregation remains optional O4; no write across branches |
| Restart-safe upload queue (`uploadQueue.js`) | Account/branch-isolated IndexedDB queue, stable intake and delivery IDs | Offline/reconnection and real-device checks R12 |
| Camera and burst capture, repeated-shot warning (`upload.js`, `imagehash.js`) | File selection currently implemented; dedicated capture absent | R13; duplicate warnings must never silently remove physical units |
| Image compression and large-source handling (`upload.js`, `imageCompress.js`) | Current upload accepts supported images up to 5 MB; does not resize large phone images | R13; document quality/original preservation policy before changing bytes |
| Upload Undo (`upload.js`, Railway intake API) | Pending upload recovery exists; post-upload correction/removal absent | R16; retain audit, guard received lots and respect delivery membership |
| PWA installation, shared photos, safe service-worker updates (`main.js`, `install.js`, `public/sw-share.js`) | Not yet implemented in the new frontend | R13; do not cache private API responses as part of app-shell support |
| Light/dark/system appearance (`theme.js`) | Redesigned light/dark appearance | Final contrast/accessibility A6 |
| Browser error reporting (`errorlog.js`, `main.js`) | Inline recoverable errors implemented; operational error sink not yet verified | T9 |
| Categories, inherited fields, users and permissions | POS owns administration; category mapping is now directly reachable | D2 must provide verified authorized paths; do not duplicate identity administration |
| General bulk edit, approve/delete and legacy user controls in source | Masked off by the deployed Railway profile; not established as active parity requirements | Preserve source as removal candidates D4; add new bulk detail actions only deliberately |
| CSV export claimed in README | No CSV action found in the active gallery/upload entry graph | Historical claim, not counted as implemented parity; retain evidence and resolve before retirement D4 |
| Local category folders, spreadsheets and migration tools | README explicitly classifies these as reconciliation/rollback evidence outside the browser graph | Retain until approved retirement D4/G7 |

The most consequential remaining parity gaps are phone intake, receiving triage, item activity and correcting an accidental upload. They are now explicit checklist items rather than being hidden under a general testing task. Inventory completion does not mean those capabilities are implemented or that staff acceptance has occurred.
