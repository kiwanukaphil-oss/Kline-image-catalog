# Photo inspection and holds

The detail editor opens a dedicated photo viewer with Fit, Zoom in/out, keyboard-focusable scrolling and a fresh authorized image URL. Reloading an unavailable image only refreshes the viewer; unsaved item details remain intact. Missing and failed images are distinguished.

For unreadable evidence, staff can save **Hold for photo or label check**. The existing revision-checked details transaction records status `flag` and the reason in the audit event. Existing publication blockers prevent receiving. Resolution uses the explicit existing problem-flag confirmation; inspection alone never clears a hold or confirms physical counts. Received items remain read-only.

Validation: 12 focused real PostgreSQL/POS tests, including stale hold rejection and explicit resolution; desktop/mobile browser verifies image failure/reload, zoom/fit, Escape dismissal, preserved unsaved form and a persisted hold. TypeScript, lint, formatting, build and 24 workspace checks pass. Package 0.7.0; no schema change.
