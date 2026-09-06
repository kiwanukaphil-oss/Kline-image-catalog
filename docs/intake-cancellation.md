# Intake cancellation

Open an unreceived lot and choose Cancel intake. Record the reason and confirm. Cancelled intake remains accessible using the Receiving task filter and can be restored with the saved details and counts. Delivery totals exclude cancelled lots and show their count separately.

Saved phone uploads also expose Cancel. Local bytes are removed only after POS acknowledges a durable cancellation for the original intake ID. Creation and cancellation share a transaction advisory lock, so a delayed upload cannot resurrect that ID. Select the original photo again for a new intake if a queued cancellation was mistaken.

Migration 108 retains cancellation actor, time, branch and reason, with restore metadata. Existing lots also get an item activity event and revision change. No photo, quantity, delivery membership or commerce record is deleted. Cancellation requires catalog.delete and branch authorization. Fixed review revisions reject stale edits; POS-linked lots cannot be cancelled. Running AI work must finish first, and cancelled lots cannot start AI or receive stock.

Validation: 41 real PostgreSQL integration tests across workspace, intake and publication; actual 390px browser cancellation, readonly details, cancelled filter, restoration and durable queued-ID cancellation. Source/package verification, lint, TypeScript and production build pass. Physical-device and staging acceptance remain separate.
