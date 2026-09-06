# POS navigation: implementation awaiting browser verification

Stock detail links now address a POS handoff route with product, branch and requested tab. Links contain no tokens. The existing POS login preserves a local return destination, and the handoff checks the logged-in account's product permission and branch membership before switching the active branch and opening the product workspace. Invalid or unauthorized links produce a bounded error. The stock/pricing links open their corresponding product tabs.

Both frontends pass TypeScript; catalog lint passes. Browser verification is not complete and this slice is intentionally uncommitted.

Automatic approval review rejected both the hidden-process and foreground launches of the local POS frontend. The only reason supplied was `blocked by policy`. The backend preview was successfully refreshed and remains on `127.0.0.1:5109` with the dedicated local test database and allowed frontend origin `http://127.0.0.1:3010`.

To unblock browser verification, run `server/tests/start-pos-preview.ps1` in a local PowerShell session and leave it running. It starts the POS frontend on `http://127.0.0.1:3010` against the test backend. No production service or database is involved. The catalog preview remains on port 5198.

Next checks: follow the product link while signed out of POS; log in and verify exact destination/branch; verify pricing and stock tabs; verify expired-session recovery and a denied branch. Staging cross-app acceptance remains separate.
