# K-Line merchandise workspace

Receiving, Pricing and Stock in one focused workspace. This is the first working implementation of the approved redesign, connected locally to the existing K-Line POS services and an isolated PostgreSQL database. It has not been deployed or committed.

## Review it locally

The running preview is at **http://localhost:5198** (IPv6 equivalent: **http://[::1]:5198**).

Use **testadmin / testpass123**. These are disposable local fixture credentials. The branch selector says **Test Store**. **New arrivals** contains editable drafts for exploring Pricing; **September delivery** contains completed receipts. Stock includes POS-only products and the merchandise received during verification.

The preview uses real HTTP requests, the real POS authentication/pricing/publication/sales services and a dedicated `kline_catalog_workspace_test` database. Test images use a local filesystem adapter with expiring signed URLs. No production stock, production account or production bucket was changed.

## Workflows

- **Receiving:** persistent delivery groups; photographs saved before upload; a visible resume action after interruption; editable category-based details; explicit size counts; one next task per lot; POS receipt review and per-lot outcomes; historical receipts.
- **Pricing:** select similar merchandise, enter one price, optionally set size exceptions, review exact before/after values, then save. Selling prices and costs have separate tasks. Filling gaps protects existing effective prices. Individual-size selection cannot alter sibling defaults. POS provides revision checks, idempotent save and conditional undo.
- **Stock:** current POS product/variant balances and prices at the selected branch, including products without catalog photos. Search by product, brand or SKU; filter by size, shortages, depleted sizes or negative balances; inspect movements. Refresh runs every 30 seconds while visible and on return to the window. A failed refresh retains an explicitly stale, timestamped snapshot.

The original app remains available in its own checkout. This is a new implementation, not a removal of its administration, extraction or advanced pricing features.

## Repository layout

| Path | Responsibility |
|---|---|
| `app/` | React/TypeScript frontend, shared visual tokens and shadcn/Base UI controls |
| `server/workspace-router.cjs` | Additional POS routes using existing authentication, permissions and branch middleware |
| `server/workspace-service.cjs` | Draft revisions, category validation, readiness and safe projections |
| `server/workspace-repository.cjs` | Parameterized queries for delivery membership, counts and current stock |
| `server/migrations/` | Additive receiving-group schema |
| `server/tests/` | Real PostgreSQL/HTTP integration checks and explicitly local fixtures |
| `app/tests/` | Chrome browser journeys, upload recovery and keyboard checks |
| `verification/` | Test results and inspected desktop/mobile screenshots |
| `design/` | Approved product direction and earlier interactive design concepts |

## Start from a fresh checkout

Requires Node 22.13 or newer, local PostgreSQL, installed Chrome, and the existing POS backend with its dependencies, migrations through the reviewed-pricing-plan migration, and the pinned receiving review contract (ADR-073). The matching POS change is implemented in the adjacent checkout; the workspace fails at startup against an older backend. The POS remains a separate dependency; it is not copied or replaced here.

The focused [POS integration patch](server/pos-patches/README.md) preserves this backend dependency for another checkout without including unrelated local POS changes.

In PowerShell, from this repository:

```powershell
$env:POS_BACKEND_PATH = 'C:\Projects\inventory-pos-system\backend'
npm --prefix app ci
node server/tests/prepare.cjs
node server/tests/preview.cjs
```

In another terminal:

```powershell
npm --prefix app run dev -- --port 5198
```

Copy `app/.env.example` to `app/.env.local` if different frontend-visible URLs are needed. Neither the browser nor this repository needs POS database credentials, a JWT signing secret or bucket credentials compiled into the frontend.

The preparation script reads connection credentials from the POS backend's local `.env.test`, rejects remote PostgreSQL hosts, excludes remote connection URLs and targets only `kline_catalog_workspace_test`. It does not reset the POS project's own test database. `node server/tests/prepare.cjs --reset` explicitly resets only this dedicated K-Line fixture database.

To leave editable sample arrivals in the preview:

```powershell
node server/tests/seed-preview.cjs
```

## Verify

```powershell
npm --prefix app run typecheck
npm --prefix app run lint
npm --prefix app run build
npm --prefix app audit
node server/tests/integration.cjs
node app/tests/browser.mjs
node app/tests/recovery-keyboard.mjs
```

The browser checks expect both local servers above. They create fixture deliveries and POS receipts. Integration tests additionally make an actual POS sale and use the POS stock repository for discrepancy/second-branch fixtures. They never use production data.

Receiving checks also cover the required actor-scoped review token, publish permission, stale-review rejection, and safe retries after partial success. The browser test makes a real competing edit after review and requires an explicit fresh review before receiving that lot. POS-side publication/pricing regression tests additionally cover protected cost changes committed while the publisher waits for a row lock.

The functional checks verify shared pricing, size exceptions, protected inherited prices, independent cost entry, cost redaction, stale edit/plan rejection, upload retry and reload recovery, duplicate receipt protection, branch isolation and image joins that cannot multiply availability. A six-unit receipt remains six after a POS sale reduces availability to five. Mobile interaction was checked at 360px; keyboard checks cover activation, modal focus trapping, Escape and focus restoration.

The optional `read_visible_stock` and `read_receiving_selection` WebMCP tools are feature-detected. This installed Chrome does not expose the required `document.modelContext` API, so native WebMCP contract validation remains unverified. Ordinary UI journeys do not depend on it.

Generated shadcn primitives are retained and excluded from application lint rather than edited to satisfy unrelated scaffold warnings. React Compiler-specific lint is disabled because this build does not enable that compiler. Semantic `role="status"` is allowed; labels for shared Input/Checkbox components remain checked. Original private image URLs are used directly rather than sent through a public image optimization cache.

## Connecting the actual POS deployment

This is release work for the next approved phase. The local host deliberately refuses production/remote databases.

1. Bring the additive SQL migration into the POS's normal, reviewed migration process.
2. Install this server adapter beside the POS backend and mount `createWorkspaceRouter(loadPosDependencies(POS_BACKEND_PATH))` at `/api/catalog-workspace`, after its security/body-parsing middleware and before its final not-found handler.
3. Allow the new frontend origin in POS CORS, including `Authorization` and `X-Branch-Id`. Configure `NEXT_PUBLIC_POS_API_URL` and the optional `NEXT_PUBLIC_POS_URL` before the frontend build.
4. Complete the release gaps in `REVIEW_BRIEF.md`, then verify with staging identities, branch permissions and the private image bucket before any rollout.

The server adapter reuses existing services; it does not introduce another user directory, stock ledger, payment flow or set of pricing rules. Normal production upload signing remains the POS storage implementation. Only the explicit local test harness substitutes filesystem image storage.

<!-- Removal candidates for a later, approved cleanup: unused generated UI primitives and superseded design concepts. Keep them until parity and review are complete. -->
