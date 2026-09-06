# Staging acceptance record

Use an isolated staging branch and test stock. Give staff the task, without explaining which controls to use. Record completion time, wrong turns, mistakes and whether assistance was needed. Screenshots and automated fixtures do not substitute for this record.

Staging: https://catalog-web-production-2d56.up.railway.app. The ignored local
file `.test-data/staging-login.txt` contains its login. Two unreceived test
deliveries are prepared: `Synthetic scale acceptance` (1,000 Hugo Boss shirt
lots) and `Shorts scale acceptance` (1,000 lots, half H&M). Each has three size
lines. Their prices were saved, checked in PostgreSQL and restored through
Undo, so staff can start with unpriced merchandise. These synthetic lots reuse
one existing photo; they are not a unique-image throughput benchmark.

Automated staging checks pass for both pricing examples and share-target,
offline/reconnect and private-cache behavior. The results below remain pending
until a person completes them without coaching on the actual store device.

| Task | Expected outcome | Result / observer notes |
|---|---|---|
| Photograph a mixed delivery on the actual store phone, including similar-looking units and one large source image | Correct number of lots; no lost or silently merged units; labels remain legible | Pending |
| Interrupt an upload, close the app, reconnect and resume | Original queued IDs complete once in the correct account and branch | Pending |
| Correct an accidental photo before and after upload | Cancellation is discoverable, audited and reversible; no sellable stock changes | Pending |
| Fill missing details with AI and review uncertain fields | Existing staff edits survive; evidence supports corrections; physical counts are confirmed separately | Pending |
| Price 1,000 unpriced items: Hugo Boss formal shirts at UGX 100,000, except XL at 150,000 | Exact selected group and exception are correct; unrelated merchandise is untouched | Pending |
| Price all shorts together, with H&M at a different price | Brand exception is easy to find; conflicting rules are visibly resolved before save | Pending |
| Restock an existing POS product, including a size that must first be created in POS | Each incoming size maps explicitly; new size starts at zero; receipt adds only the confirmed units | Pending |
| Receive the reviewed delivery, interrupt one response and retry | One durable receipt per lot; stock is not duplicated; photo failures retry separately | Pending |
| Sell or transfer a unit in POS, then monitor it in Stock | Selected-branch availability updates while historical received quantities remain unchanged | Pending |
| Let the session expire while editing and sign back in | Same-account input and active branch are preserved; no automatic mutation retry | Pending |
| Use keyboard navigation, dark appearance, installed app and OS photo sharing on the real device | Controls remain legible, focus is predictable, and shared photos require review before upload | Pending |

Release approval requires the owner to resolve failures, confirm the private-bucket restore and production backup plan, name monitoring/rollback ownership, and approve deployment. Optional O1–O5 remain separate scope decisions. Superseded code and evidence are retained until an explicit retirement decision.
