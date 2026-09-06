# Required POS contract

The workspace requires the publication contract described in ../../docs/ADR-073-pinned-catalog-receiving-review.md. The adjacent POS checkout already contains this change. This patch preserves only this task's four runtime/test file changes for review or transfer to another checkout; unrelated AI work is excluded. It was generated against POS commit 2d573e4f831f1515549d9b2cba7f1c59525a9bf3.

For a separate compatible POS checkout, inspect the patch, run `git apply --check <absolute-patch-path>` from the POS root, then apply it within the approved integration phase. Copy the ADR into POS docs/decisions as part of that review. Do not apply it again to the current adjacent checkout. Run the canonical catalog-publication and catalog-pricing-plans Jest suites afterward. This patch is not a deployment or a substitute for staging verification.
