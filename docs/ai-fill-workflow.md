# AI fill workflow

Staff select photographed lots in Receiving and choose **AI fill**, or open one lot and use the same action. The feature appears only when the POS reports that AI is enabled and the staff member has edit permission.

The selection screen checks saved POS jobs before showing which photos remain. Starting a run fills one photo at a time. **Stop after this photo** finishes the active server request and leaves the remaining photos untouched. Completed results remain in POS and reopening the screen offers review, not another automatic inference request.

The existing POS service saves suggestions only into fields that are still empty after inference. Existing values, including edits made during the provider request, remain protected. This is a fill-and-review workflow; it does not stage all suggestions in a second approval system. It never sets selling prices or receives stock.

In Details, **Check suggestion** identifies uncertain values next to their input; expanding it reveals confidence and the observed evidence. High-confidence values use **From photo**. Original visible label text is available under **Text read from photo**. Staff correct values normally and use **Save reviewed details**. The server validates the same signed edit revision, audits the reviewed field names, clears those fields' AI confidence markers, and retains original observations and AI events as history. Manual changes also clear outdated confidence for changed fields. Unseen fields are not implicitly reviewed.

Suggested size distributions appear in Sizes & quantities. Staff still confirm physical quantities explicitly before receiving. AI cannot replace an already human-confirmed distribution. Inputs and task switching are disabled during an in-flight single-photo fill; unsaved edits must be saved first.

After a failed or uncertain response, the UI stops the queue and offers **Check saved progress**. It does not automatically repeat a potentially paid request. A saved success is reviewed; a recorded failure becomes an explicit retry choice. A still-running job remains visibly running. Server-restart/orphaned-job recovery and real-provider quality remain staging acceptance tasks, not guarantees inferred from the local fixture.

Local verification uses real POS routes, permissions, job persistence, PostgreSQL and browser interactions. Only the external inference response is deterministic. It proves selection, stopping/retry, protected fields, evidence review, correction, quantity confirmation and lost-response reconciliation. It does not measure vision accuracy or spend a real provider request.
