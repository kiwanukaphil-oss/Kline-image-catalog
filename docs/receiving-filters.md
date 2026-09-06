# Receiving filters

All merchandise and delivery contents now share Task, Category and Sort controls. Task choices separate unreceived stock, counts, retail prices, flags, POS-link checks and received items. The server applies them before pagination, together with the authorized branch and selected delivery.

Filtering resets the current selection and page. Empty results retain the chosen filters and offer Clear filters; clearing preserves delivery and sort. Readiness is still checked independently from authoritative receiving data.

Verified with 18 POS workspace tests, including an old flagged row beyond the initial 48 results, and mobile browser checks in `verification/receiving-filters.json`. Package 0.12.0, TypeScript, lint, build, formatting and installed-source comparison pass.
