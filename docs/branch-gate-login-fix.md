# Branch gate login correction — 12 September 2026

The initial gate called `/catalog/session` without `X-Branch-Id`. The POS route uses `resolveBranchContext({required:true})`, which rejects that call for accounts with multiple branches with `Select a branch before continuing.` Authentication succeeded, but the branch selector never rendered.

Restore the `/auth/me` metadata read and use its POS-provided default branch only for the `/catalog/session` capability/branch-list request. Do not store that default as a selection or mount any merchandise workspace. The gate still requires an explicit choice. Its entry request rechecks the selected branch, and existing explicit-choice persistence and in-workspace switching remain.

The original intercepted browser responses incorrectly accepted a session request with no branch. The regression fixture now reproduces the server rejection and provides the real `/auth/me` response shape. All 11 browser scenarios pass, including no merchandise requests before explicit selection. TypeScript, lint and the Node production build pass.

This corrects the previously approved live gate release. No database change or Git commit is required. Production verification uses the deployed frontend with isolated API responses; it does not claim a real-account sign-in test.

Deployed successfully: 6a5ea930-3aeb-4e4f-a9c2-dc57d02cf78b. All 11 deployed-frontend regression checks passed with branch-required session responses. Catalog and API health returned HTTP 200. The actual POS middleware contract check also passed with database lookups stubbed; see verification/branch-gate-pos-contract.json. Release evidence: verification/branch-gate-login-fix-release.json.
