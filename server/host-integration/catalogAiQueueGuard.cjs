// Host extraction integration: keep single-photo and queued requests behind the same reservation.
const DomainError = require('../errors/DomainError');

/** Require the live worker token for reserved items, including paused batches. */
async function requireReservation(client, itemId, queueClaim) {
  const result = await client.query(`SELECT id,claim_token,state,lease_until>now() AS live
    FROM catalog_workspace.ai_batch_items WHERE item_id=$1 AND state IN ('queued','running','attention') FOR UPDATE`, [itemId]);
  const entry = result.rows[0];
  if (queueClaim && (!entry || entry.id !== queueClaim.id || entry.claim_token !== queueClaim.token || entry.state !== 'running' || !entry.live))
    throw DomainError.conflict('Background AI ownership changed. Check saved progress.');
  if (entry && !queueClaim) throw DomainError.conflict('This photo belongs to a background AI batch. Open its saved progress.');
}

async function linkAttempt(client, queueClaim, jobId, usageId) {
  if (queueClaim) await client.query(`UPDATE catalog_workspace.ai_batch_items SET job_id=$3,usage_id=$4,updated_at=now()
    WHERE id=$1 AND claim_token=$2`, [queueClaim.id,queueClaim.token,jobId,usageId]);
}

/** A stale worker must never apply fields after its lease has been reconciled. */
async function requireLiveAttempt(client, jobId) {
  const result = await client.query(`SELECT state,lease_until>now() AS live FROM catalog_workspace.ai_batch_items
    WHERE job_id=$1 FOR UPDATE`, [jobId]);
  if (result.rowCount && (result.rows[0].state !== 'running' || !result.rows[0].live))
    throw DomainError.conflict('This background attempt expired. Its late result was not applied.');
}

async function completeEntry(client, jobId) {
  await client.query(`UPDATE catalog_workspace.ai_batch_items SET state='done',message='Ready to review',
    lease_until=NULL,updated_at=now() WHERE job_id=$1 AND state='running'`, [jobId]);
}
module.exports = { requireReservation, linkAttempt, requireLiveAttempt, completeEntry };
