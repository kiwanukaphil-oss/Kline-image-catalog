# Workspace administration

Workspace settings separates occasional configuration from daily work. Categories and fields supports creating a category, choosing its parent, and editing labels, choices, required status and inheritance. Inherited fields are shown in the child. Existing field keys/types and category ancestry remain fixed; evidence is not rewritten and deletion is not exposed. Reload definitions explicitly abandons an unsaved definition.

Category mappings connects catalog definitions to existing POS categories. Users and permissions opens the existing POS users route; POS authenticates and authorizes the operator. Diagnostics shows the installed package, AI enablement, interrupted jobs and questionable POS links for the selected branch, without secrets or raw provider messages.

The APIs require settings.categories, users.view or settings.edit as appropriate. A global revision rejects stale authoring. Schema edits take an exclusive advisory lock while receiving and detail transactions hold the shared lock. Changes are audited in the same transaction. Catalog reference lists refresh after an edit.

Verified: package 0.16.0, 23 workspace PostgreSQL tests, real 390px category creation/inheritance and diagnostics, mapping round trip, no dialog horizontal overflow, TypeScript/lint/build and installed-source comparison. Staging and staff acceptance remain release gates.
