# Bulk preparation release review

Status: owner-approved deployment completed on 12 September 2026. Backend and frontend are live; no Git commit was created.

Receiving now offers **Prepare selected** for a complete filtered selection, including products on other pages. Staff can apply common details, edit sizes and quantities in one table, resolve flags, and confirm counts together. Recorded single sizes appear as proposals; ambiguous labels require a size entry. Existing confirmed counts stay unchanged unless explicitly included.

The batch screen connects to bulk prices, costs and receiving. Saved successes can continue while invalid products remain unfinished. A failed row has its own result and retry path. Receipt exceptions offer **Prepare all exceptions together**. Individual editors remain available and optional.

The requirements panel supports multiple explicitly assigned replacement photos, shared category connections and checks or ungrouping of complete selected product groups. Ungrouping retains source lots and quantities. Existing matching tools can regroup them. Partial groups must include all source lots before group changes. Category connections retain their existing cross-branch scope and permissions.

## Verification

- A real local POS browser journey prepared, priced and received 52 lots across three pages, producing exactly 60 units. It covered Cotton and Short sleeve shared values, multiple sizes, preserved confirmed quantities, an ambiguous size and retrying only the corrected exception.
- Real HTTP tests passed batch validation, independent row transactions, stale revisions, branch isolation, edit permissions and safe photo retries. Previous photo files, attributes and quantities remained intact.
- A second real browser journey attached two assigned photos, checked and ungrouped a product group, and saved then changed a category connection using refreshed revisions. No stock was received.
- Existing integration checks passed pricing, receiving, duplicate receipt protection, received-lot protection, sales and branch stock separation.
- Type checking, lint and the Node production build passed. Desktop and mobile layouts were inspected; mobile dialog bounds and internal width were checked after resize settled.

Evidence: `verification/bulk-preparation-browser.json`, `bulk-preparation-api.json`, `bulk-preparation-exceptions.json`, `integration.json`, and desktop/mobile screenshots.

## Release requirements

Deploy the updated POS workspace addon **0.24.0** and catalog frontend together, backend first. The frontend requires the new batch read/save and source-photo endpoints. No database migration is required. Existing permission and revision checks remain enforced by the backend. Batch requests are bounded to 50 reads or 20 writes, with writes split further by payload size.

The established Railway deployment should include the new untracked source files explicitly. Exclude unrelated Android work and local test fixtures. Preserve the already deployed branch-selection login fix. Production products and counts have not been changed during this implementation phase.

Owner confirmation is required before the deployment phase, as specified in the project preferences. No commit is proposed automatically.

## Deployment verification

Backend 422533a5-bdc0-4029-80ae-f7cc50fe84ce and frontend e20bd304-0d3f-43fd-a478-b39077022a40 succeeded. Public API health returned 200 and unauthenticated batch reads returned 401. The hosted frontend passed batch photo, category, group and mobile tests against isolated local POS fixtures. Production merchandise was not changed. Release snapshots, package hash and rollback deployment IDs are recorded in erification/bulk-preparation-release.json. The backend snapshot preserves the deployed storage-signing correction.
