# Extraction consistency review

Status: deployed with owner approval on 12 September 2026. Backend package 0.26.0 and the frontend both report SUCCESS. The five extraction settings were read back and verified, including GPT-5.6 Sol. Production product records were not changed by this deployment.

## Findings and corrections

| Finding | Resulting policy or behaviour |
| --- | --- |
| The prompt explicitly requested hedged material names. | Choose one material or blend; inference belongs in confidence/evidence. Reject alternatives, placeholders and unsupported percentages. Printed composition wins. Cotton is not a global default. |
| Generic garment names omitted sleeve, colour and pattern; brand capitalisation differed from POS. | Compose design names such as `Oxford Short Sleeve Shirt - Navy Floral Paisley`, resolve known brand casing/approved aliases, preserve look-alike spelling and printed model identifiers. Exclude size, material, price and quantity from clothing names. |
| A staff edit during inference could leave an AI-filled name inconsistent with the saved attributes. | Recompose only a newly AI-filled garment name under the item lock using the final saved brand/attributes. Preserve manually saved names and other nonblank fields. |
| Extraction, count entry, matching and suggestions used different size aliases. | Share canonical server aliases: XXL → 2XL, XXXL → 3XL, through 6XL; word equivalents are supported. Legacy aliases sort alongside canonical sizes in the app. |
| Ambiguous `2XXL` could be mistaken for a safe alias. | Preserve it with Low confidence; do not silently map it to 2XL or 3XL. The original text remains available for bulk correction. |
| Shirts can show an alpha size and a neck measurement on one tag. | Use the alpha size as the primary shirt size; retain the neck measurement in transcription/evidence. Preserve actual M/L dual sizes. |
| Trouser normalisation discarded inseam data. | Preserve waist/inseam, regional sizing systems, half sizes and numeric neck ranges. Do not round to available options or convert clothing/shoe systems. |
| Colour, pattern, sleeve and fit had inconsistent synonyms/casing. | Normalize equivalent terms such as Navy Blue → Navy, Plain → Solid and Slim Fit → Slim. Keep Blue distinct from Navy and pattern distinct from colour. |
| AI stock rows could repeat aliases for the same size or claim a size tag as count evidence. | Require explicit lot wording quoted in the transcription; reject duplicate alias rows. Count suggestions still require bulk physical-count confirmation. |
| Numeric fields could receive objects/booleans; inference confidence could claim High certainty. | Reject malformed provider values, retain numeric types, remove orphan confidence, and cap inferred composition at Medium. Numeric field units belong in field definitions and evidence. |
| Image/caption instructions could compete with extraction instructions. | Treat photographed text and saved data as data, not executable instructions. Product-specific notes can clarify lighting; unrelated text cannot override extraction rules. |
| Model/default settings differed. | Target `gpt-5.6-sol`, medium reasoning, original-detail images, strict structured output. Defaults allow 90 seconds and 8192 output tokens; transport attempts are capped at three so both passes fit below the 15-minute orphan window. |

## Verification and limits

Seven deterministic consistency groups passed, including shared aliases, dual shirt sizes, materials, numeric types, naming, stock evidence and the Sol request schema. A real local PostgreSQL extraction test passed concurrent staff corrections, name recomposition, preserved confirmed quantities and durable model recording. Background queue ownership/recovery and grouped-product receipt tests passed. Candidate-matching regression fixtures, frontend type checking, lint and the Node production build passed.

Real API calls confirmed account access to GPT-5.6 Sol and image/structured-output compatibility. Four initial blind shirt probes exposed sleeve disagreements with the owner's corrections, combined alpha/neck sizes and one absent material. These are recorded as findings, not successful visual identifications. After revision, two further probes supplied the owner's already-confirmed Short/Cotton values: the returned names and primary sizes were consistent. This is a small compatibility/policy evaluation, not evidence of general visual accuracy. Folded clothing can remain ambiguous; staff corrections and explicit physical quantity confirmation remain authoritative and bulk-capable.

Evidence: `verification/extraction-consistency-tests.json`, `verification/extraction-consistency-persistence.json`, `verification/extraction-sol-photo-evaluation.json`, `verification/extraction-sol-confirmed-photo-evaluation.json`, and `verification/ai-batches-integration.json`.

Existing saved names and prior AI-filled material values are not automatically rewritten by fill-empty extraction. Historical catalogue cleanup should use a separately reviewed bulk change; this release does not rerun paid extraction on old records, relabel products, receive stock or merge products.

## Deployment

The isolated host is `.test-data/ai-consistency-20260912/pos`. `server/host-integration/apply-extraction-policy.cjs` applies the reviewed host changes and copies the shared policy module; it preserves the existing background queue and storage fixes. Install package 0.26.0, deploy backend first, and explicitly set `OPENAI_MODEL=gpt-5.6-sol`, `OPENAI_REASONING_EFFORT=medium`, `OPENAI_TIMEOUT_MS=90000`, `OPENAI_MAX_OUTPUT_TOKENS=8192` and `OPENAI_MAX_ATTEMPTS=3`. A pre-existing Railway model override otherwise wins over the new default. Deploy the app's size-order change afterwards. No schema migration is required.

Official model compatibility: https://developers.openai.com/api/docs/models/gpt-5.6-sol (accessed 12 September 2026).

## Deployment verification

Live: https://klinemen-catalog.com. Backend `7e16d7fb-572d-45ee-be0d-263eb0cf77ec`; frontend `e10e712a-304e-405d-a558-fc5d89948eaf`. Backend health and catalog returned HTTP 200. All eleven hosted login/branch checks passed using intercepted API fixtures after one transient navigation timeout. No production extraction jobs were triggered for this check. Release evidence: `verification/extraction-consistency-release.json`. No commit was created.
