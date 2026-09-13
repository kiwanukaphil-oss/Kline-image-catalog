# Branch workspace entry gate

Deployed and verified on 11 September 2026; no Git commit created.

Fresh sign-in opens a required branch-selection screen with no preselected branch. Only branches marked available by the existing authenticated catalog session are offered. Even a single available branch requires a deliberate choice. Entry rechecks access with the selected branch before mounting Receiving, Pricing or Stock.

The in-workspace branch switcher and existing unsaved-work navigation protection remain available. Explicit choices persist within the browser tab through refresh and same-account session recovery. Sign-out clears the choice. Legacy automatically saved defaults, selections belonging to another account and inaccessible remembered branches return to the selection screen.

Validation: TypeScript, lint, Node production build, and 11 intercepted-API browser regression scenarios passed. Desktop and 390px mobile screenshots were inspected. Regression fixtures do not contact production. The broader legacy browser suite was not run; sign-in journeys in that suite need an explicit gate choice. The existing session-navigation journey has been updated accordingly.

Evidence: `verification/branch-workspace-gate.json`, `verification/branch-gate-desktop.png`, `verification/branch-gate-mobile.png`.

Owner approved deployment on 11 September 2026. No database migration or backend deployment is needed for this frontend gate. This is an operational entry guard; existing server-side branch permissions remain authoritative.


Production deployment: 8813183d-8123-42f8-b25d-1b262aaec60c (SUCCESS). Catalog and API health returned HTTP 200. All 11 branch-gate browser checks passed against the deployed frontend using isolated API responses. Existing receipt and upload recovery features were also verified in the shipped client. Release snapshot, hashes and previous deployment are recorded in verification/branch-gate-release.json.
