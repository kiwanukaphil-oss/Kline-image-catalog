# Jeans caption and extraction review — 13 September 2026

Reviewed all 29 original images and saved AI results in the latest NAMUGONGO delivery (`59d8974d-f8cc-4012-82f8-b487039aee7b`). No production merchandise was changed. The row-level findings are in `verification/jeans-caption-review.json`.

## Findings

- All 29 size numbers match the photos. Seven come from added captions. One Diesel waist is inconsistently stored as `W40` instead of `40`.
- **24 count rows have no size**, despite the saved size attribute. The bulk editor already proposed most saved sizes; the individual editor did not. The initial progress estimate of 23 blank rows was off by one; the final count is 24.
- Seven captions specify quantities: five lots of two and two lots of three. Their saved quantities match. The other 22 one-unit rows are intake defaults, not photo-verified quantities. Saved total: 38 units; only 16 units are explicitly described by quantity captions.
- Material varies between Denim (23), Cotton (4) and Cotton Blend (2), without a visible composition label or material caption establishing those fibre guesses. Denim is the consistent fabric description supported by this batch.
- Five American Eagle photos show both American Eagle and American Eagle Outfitters branding. Names inconsistently include small codes read as 0310, 6310 and 8310, or no code. These code fields are candidates for reinspection/removal, not confirmed different products. They have not been deleted or used to merge products.
- Washed blue GAP photos and dark blue Diesel photos show Blue/Light Blue/Dark Blue variation. These are visual tone judgments; the Boss Dark Blue captions are explicit and take precedence over appearance.
- One Zara size caption was wrongly classified as a physical label in evidence.

## Prepared changes

Policy `2026-09-13.1` specifies caption > manufacturer tag > observation > inference for every extracted product field, with examples for bare `linen`, `40` and `Blue`. It distinguishes factual captions from text attempting to change the extraction rules. Caption evidence is represented explicitly in the strict schema and retained through normalization, including material percentages actually written in a caption.

Single-size quantity notes carry the extracted size even when the size appears on a separate tag. A size-only caption cannot create a quantity. Waist-only jeans labels normalize to a number; full waist/inseam measurements retain both dimensions. Material guidance uses Denim consistently for visually identifiable denim without a stronger caption/composition statement. Generic garment types cannot be used as model/style identifiers.

The individual count editor now shares the bulk count proposal logic, including W40 and other unambiguous labels. Existing size rows, quantities, multi-size lots and human-confirmed counts stay protected. Suggestions still require the existing bulk confirmation action; no additional review gate was introduced.

Host installer: `node server/host-integration/apply-caption-policy.cjs <isolated POS backend>`. Tested against a separate copy of the deployed 0.26.0 backend at `.test-data/caption-consistency-20260913/pos/backend`. Existing staff values remain protected by fill-empty persistence. Deploying this policy alone does not rewrite already populated product names/materials.

## Validation

- Five caption-specific regression groups and seven existing extraction consistency groups passed.
- Shared individual/bulk count proposal tests passed, including quantity preservation, confirmed counts and ambiguous/multiple-size protection.
- Matching candidate regressions passed.
- Frontend typecheck, lint and production build passed.
- Four unchanged original photos were tested directly with GPT-5.6 Sol, without invoking catalog mutation endpoints. Zara caption size 34, Diesel W40→40, American Eagle 36/32 with two pieces, and Boss caption size 36 / Dark Blue / three pieces were correctly extracted. All four chose Denim. See `verification/jeans-caption-sol-evaluation.json`.
- These four photos do not contain a material caption conflicting with a physical composition label. That priority is covered by instructions/schema/normalization checks, not claimed as a real-image conflict benchmark. Colour inference still varies where there is no caption.

Deployed with user approval on 13 September 2026 as package 0.27.0. Backend and frontend reported SUCCESS; both live endpoints returned HTTP 200 and the caption evidence hint was verified in shipped assets. All 11 hosted branch-workspace browser checks passed using intercepted API fixtures. See `verification/caption-consistency-release.json` and `verification/caption-release-branch-gate.json`.

Existing merchandise names/materials have not been rewritten. The shared count display fix uses their already saved sizes without altering quantities. No commit or push was made.
