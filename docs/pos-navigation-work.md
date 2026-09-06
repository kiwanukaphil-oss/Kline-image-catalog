# POS navigation

Stock links open an authenticated POS handoff containing product, branch and requested tab, never tokens. POS rechecks product access and branch membership before changing branch and opening the corresponding product tab.

Login guards and the login form share one local-only return destination. Expired-session API redirects retain it in tab-scoped storage until authentication completes. External, backslash and login-loop destinations are rejected. This fixes the race where the authenticated login guard previously redirected to Dashboard before the form could resume the product.

Verified locally against both real apps: separate login, exact product/pricing tab, correct destination branch, stock tab, expired session and rejected unauthorized branch. Six redirect-safety tests pass; both frontend TypeScript checks and catalog lint/build/format pass. Evidence: verification/pos-navigation.json and pos-handoff-desktop.png.

The user-started POS Vite preview listens on port 3000; the helper and catalog development links now match it. Catalog remains on 5198 and the dedicated test backend on 5109. Production requires NEXT_PUBLIC_POS_URL, the exact allowed origin and enabled POS branch selection. Cross-origin staging acceptance remains I6/G5.
