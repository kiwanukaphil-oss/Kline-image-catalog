# Implementation decision: POS-owned commerce, dedicated preparation UI

Approved direction: Receiving, Pricing and Stock, with group pricing as the ordinary case and size exceptions as an explicit edit. The empty `kiwanukaphil-oss/Kline-image-catalog` repository hosts the new frontend and the narrow POS extension.

The extension now ships as a private, versioned npm tarball installed into the normal POS backend. Migration 106 belongs to the POS migration manifest. `CATALOG_WORKSPACE_ENABLED=true` mounts the package through the existing POS security middleware. It requires no sibling catalog source tree at runtime. See `pos-release.md` and ADR-074 for the release boundary.

## Boundaries

The browser holds a POS JWT in tab-scoped session storage. It sends the active branch on every scoped request. Credentials are used only by the existing login endpoint. The server resolves actual permissions and branch access independently of anything shown or hidden in the UI.

Pending photo bytes and stable intake IDs survive reload in IndexedDB, scoped by account and branch. A group is committed to browser storage atomically before uploads start. A successful upload is not removed from the queue until its persistent delivery membership is saved. Retrying after either a lost upload acknowledgement or failed membership write reuses the same ID.

New receiving groups and memberships live in `catalog_workspace`. Catalog identity, category definitions, evidence and normalized size lines remain in `inventory`. Public POS products, variants, branch inventory, movement records and publication receipts retain their existing owners.

The new detail/count endpoints lock the catalog item and normalized lines, compare a signed revision and refuse published edits. Revisions include all loaded publication inputs and are HMAC-signed with the POS server secret; cost values are never exposed merely to let the browser perform concurrency checks. Count updates reuse the POS normalizer and variant-line repository within the same transaction.

Receiving uses a separate actor/branch-scoped publication revision returned with the detail snapshot. The receive route requires it, and the POS service compares it inside the same transaction that creates products, variants and stock. Parent locking precedes the joined snapshot read so a wait for a preceding writer cannot preserve old cost data. Changed lots return 409 and need an explicit fresh review; completed lots reconcile before revision comparison, preserving safe retries. See POS ADR-073.

Pricing inputs compile into the existing reviewed-plan contract. The parent default changes only when every size is selected. A subset generates explicit selected-line edits. Fill/revise intent and existing-size protection remain server-owned. Cost-only plans use `retail_mode: leave`.

Stock begins with POS variants and joins branch inventory exactly once. A lateral image query chooses one evidence photo per product. Additional evidence therefore cannot multiply quantity. POS-only products remain visible. Null reorder configuration is preserved; stock errors do not become zeroes. Only retail prices appear in the stock projection.

Stock accepts exact `category_id` and `brand_id` UUID filters alongside size/state/search. Search includes variant barcodes. Category choices include their full paths and, like brands/sizes, remain available even when the current combination returns no products. The common product taxonomy does not expose other branches' quantities. Barcode/SKU matches narrow the matching variant rows just as size filtering does.

## New endpoints

All routes require `catalog.view`, existing JWT authentication and a valid active branch. Writes have additional permission gates. Results are not publicly cacheable.

| Method and path under `/api/catalog-workspace` | Additional gate | Purpose |
|---|---|---|
| `GET /batches` | — | Branch deliveries and receipt progress |
| `POST /batches` | `catalog.upload` | Idempotent named delivery creation |
| `PUT /batches/:id/items/:itemId` | `catalog.upload` | Branch-safe, idempotent membership |
| `GET /items` | — | Paginated lots, membership and publication blockers |
| `GET /items/:id` | — | Fresh draft projection, category fields and revision |
| `PATCH /items/:id` | `catalog.edit` | Revision-checked draft identity |
| `PATCH /items/:id/count` | `catalog.edit` | Revision-checked physical quantities |
| `POST /items/:id/receive` | `catalog.publish` | Receive the exact reviewed snapshot, or reconcile its existing receipt |
| `GET /stock` | `inventory.view` | Branch/variant POS availability, filters and freshness |
| `GET /stock/:id/movements` | `inventory.view` | Latest 50 product movements at that branch |
| `GET /receipts` | — | Latest 200 historical lot receipts, optionally by delivery |

Existing POS endpoints continue handling login, reference data, upload, optional extraction, pricing workspace/preview/apply/undo and publication. A received lot always re-enters the existing idempotent publication boundary on retry.

## Deliberate release limits

The pinned receiving review is implemented and verified locally. The workspace requires the corresponding POS service change and fails at startup if it is missing. The legacy POS publication endpoint remains compatible without a token; the new workspace always requires one. Multi-lot receiving remains a set of independent transactions, with per-lot outcomes and explicit recovery after partial success.

No durable product-image copy or restock-to-existing-product matcher is introduced. Stock can already display linked private catalog images, but the POS product-image field itself is unchanged. Current publication still creates a new POS product. Extra label/evidence attachments, reusable price lists, receipt-history pagination and broader administration parity belong to follow-up work rather than hidden controls on daily screens.

This local slice validates actual POS reads and writes against a dedicated test database. It does not claim production CORS, live bucket, AI extraction, cross-application single sign-on or POS deep-link behavior has been exercised.
