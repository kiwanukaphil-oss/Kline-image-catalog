# Suggested product matches — proposed first release

Status: implementation and deployment approved and completed. Live verification passed on 9 September 2026. See [implementation results and deployment review](match-suggestions-release-review.md).

## Outcome

After AI fill, Receiving offers groups of separate lots that appear to be the same product in different sizes. Staff inspect the original photos, confirm the identity, and later receive the group through the existing POS workflow.

Example: the six reviewed Mack Weldon photos labelled `26201A-6` become a suggestion for one product with M, L, XL, 2XL, 3XL and 4XL. Each source lot remains available with its photo and history.

## First-release matching rules

| Evidence | Rule |
|---|---|
| Model/style code | Require a complete, identical code supported by visible label/caption text or staff confirmation. Use the existing `style` attribute where available. Do not extract identity from a generic product name or internal SKU. |
| Normalization | Trim outer whitespace and compare case-insensitively. Preserve leading zeros, punctuation, internal spacing and every suffix. Do not equate O/0, I/1, A/B, or omit a suffix. Original spelling remains visible. |
| Brand | Require the same confirmed brand identity or the same normalized spelling. Ignore case and repeated whitespace only. Different spellings require correction or explicit review; no fuzzy brand merging. |
| Category | Require the same catalog category for lot-to-lot suggestions and a valid, matching POS category for an existing-product suggestion. Show the complete category path. |
| Colour/design | Identical known colour and compatible known pattern, fit and sleeve values allow a standard suggestion. Missing evidence produces “Check differences.” Conflicting known colour/design values must not enter the standard group. |
| Size | Exclude size from product identity. Preserve each size as a variant dimension. Retain established size-alias handling such as XXL/2XL; never convert shoe sizing systems. |
| Material | A disagreement is shown as a review issue; do not silently choose the first lot’s value. If the shared product needs a material value, staff resolve the disagreement or leave an optional value unset. |
| Eligibility | Only active, unreceived, uncancelled lots in the active branch. Already grouped lots are excluded. Start with the current delivery, with an explicit option to include other unreceived deliveries in the branch. |
| Existing POS products | Suggest only active, eligible products with verifiable brand/model evidence and matching category. Missing model metadata leaves ordinary manual POS search available. Multiple possible targets require an explicit choice. |

Do not form groups by chaining partial pairwise matches. Every member must satisfy the group’s shared identity and compatibility rules. A missing attribute cannot bridge two conflicting designs.

Two suggestion states:

- **Same model code:** the required identity evidence agrees and no unresolved design differences are present. Staff confirmation is still required.
- **Check differences:** the model and brand agree, but required comparison evidence is missing or attributes disagree. Explain each issue; require correction, exclusion or an explicit documented resolution before confirming the group.

No complete model code means no automatic candidate in this release. Visual-only matching and an additional AI model are deferred.

## Extraction and refresh behavior

1. Keep the existing AI fill process and protected staff edits. Ensure participating categories expose an optional model/style field; do not make model code a receiving requirement for generic merchandise.
2. Only printed/caption-supported codes or staff-confirmed codes qualify. Retain the supporting text and source. An AI confidence label by itself is insufficient evidence.
3. Recompute suggestions after extraction finishes for a lot, after reviewed identity changes, and when Receiving is reopened. Use saved extraction data; opening suggestions makes no additional AI request.
4. Show suggestions independently of whether prices or quantities are ready. Their state must not delay or fail an otherwise successful AI extraction.
5. Recheck source revisions and group membership when staff confirm. If a source changed, refresh the comparison instead of applying a stale decision.

## Review-card design

Receiving gains a **Suggested matches (3)** entry near AI fill and existing matched products. It is separate from saved groups. Selecting it opens cards such as:

```text
SAME MODEL CODE                         6 photos
Mack Weldon · 26201A-6
Clothing → Shirts → Formal

[Photo M]   [Photo L]   [Photo XL]   [View all 6]
Same printed model code and brand
Colour: [saved colour] · Design: [saved details]

Size totals from confirmed source counts
M 1 · L 1 · XL 1 · 2XL 1 · 3XL 1 · 4XL 1
6 units total

Destination: One new product
[Review group]                         [Keep separate]
```

The expanded review shows every original photo, its model-code evidence, saved size/count and differences. Desktop uses adjacent photos; mobile stacks the same information without hiding warnings or actions.

Actions and effects:

- **Exclude item:** remove a lot from this proposed group and recalculate the preview. It remains an independent lot.
- **Keep separate:** dismiss this exact member/identity combination. Persist the decision across reloads; offer dismissed suggestions for reconsideration. Reconsider automatically only when relevant identity evidence or membership changes, not when price changes.
- **Confirm group:** save one reviewed matching plan. This does not receive stock or change prices. A group without a POS target must contain at least two lots; one lot can be matched to an eligible existing POS product.
- **Receive group:** use the existing separate receiving review, showing exact size totals, new/restocked variants and commercial effects.

When source quantities have not been confirmed, show **Counts need confirmation** rather than a reliable total. Show the recorded quantities as unconfirmed; do not derive counts from the number of photos.

## Integration boundaries

The current `server/product-matching.cjs` uses receiving-readiness validation when loading members for a saved match. Split identity/membership validation from receipt validation so a reviewed group can be saved before pricing/count completion. Keep all receipt blockers in the receiving review and transaction.

Reuse the existing saved matching plans, branch/permission checks, deterministic locks, stale-revision checks and idempotent receipt behavior. Prevent overlapping membership even when two staff confirm suggestions concurrently. New suggestions never alter already received products, source lots, original photos or confirmed quantities.

The matching service currently chooses the first source material for a new product and can apply shared colour/fit defaults. The suggestion-confirmation path must require explicit resolution of conflicting shared attributes; it must not silently use those defaults to make an incompatible group appear consistent.

For POS targets, retain current price/cost protection and variant checks. If usable model evidence is unavailable in POS metadata or linked source evidence, do not invent an automatic match from the product’s display name.

## Validation and release gates

Use the 67-photo review in `docs/namugongo-product-matching-review.md` as a labelled baseline, not as permission to regroup current production records.

- The 12 reviewed groups cover 41 lots; 26 lots were kept separate. Freeze the reference identities and counts used in that review for repeatable tests.
- Measure candidate precision and recall separately. With correctly extracted identity evidence, recover all 12 reference groups with no false standard suggestions among the keep-separate cases. Report missed groups caused by missing/incorrect extracted evidence rather than silently filling it from the answer key.
- Keep `26201B-16` distinct from `26201B-26`, `26201A-14` from `26201B-14`, and `0663-29` from `0663-11`. Obscured suffixes and the unlabelled Manschett examples must not form standard suggestions.
- Preserve the reference total of 126 units across the full reviewed fixture. B-25 must retain XL quantity 2; D9663-2A must retain XL quantity 2. Photos alone cannot prove two physical units.
- Cover missing colours, conflicting designs/materials, repeated photos, unconfirmed counts, cross-branch records, existing POS ambiguity, stale edits, concurrent confirmation, excluded members, dismissed suggestions and retry after receipt.
- Verify desktop/mobile comparison, keyboard access, image inspection and error recovery. Record suggestion latency and confirm that discovery makes zero additional model calls.
- Release only after the above checks pass. Validate on isolated fixtures first; no automatic regrouping of yesterday’s received merchandise.

## Proposed implementation sequence

1. Build exact-code candidate discovery and its regression fixtures; audit availability of model evidence in catalog and POS records.
2. Add the review cards, exclusions, persistent dismissals and conflict-resolution behavior.
3. Connect reviewed suggestions to saved matching plans, separate identity confirmation from receiving readiness, and run end-to-end regression checks.
4. Present the tested result for deployment approval under the owner’s phase-confirmation preference.

Approval of this specification authorizes implementation steps 1–3. Production deployment remains the next review point.
