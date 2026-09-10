const { randomUUID } = require('node:crypto');

/** Persist batch intent independently of browser lifetime; keep all mutations serialized with extraction reservations. */
function createAiBatchService({ source }) {
  const { pool } = source('config/database');
  const DomainError = source('errors/DomainError');
  const User = source('models/User');
  const Branch = source('models/Branch');
  const extractor = source('services/catalogAiExtractionService');
  function requireHostProtocol() {
    if (source('models/CatalogAiRun').backgroundQueueVersion !== 1)
      throw new DomainError('Background AI fill requires the compatible POS queue integration.',503);
  }
  /** Serialize reservation changes with host extraction startup, then release locks before inference. */
  async function queueTransaction(action) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('catalog.ai.queue'))");
      const value = await action(client);
      await client.query('COMMIT');
      return value;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function assertRequesterAccess(userId, branchId) {
    const user = await User.findById(userId);
    const permissions = new Set((await User.getEffectivePermissions(userId)).map(row => row.permission_name));
    if (!user?.is_active || (!permissions.has('system.admin') && (!permissions.has('catalog.edit') || !permissions.has('catalog.view'))))
      throw new DomainError('The requester no longer has permission to run this batch.', 403);
    if (!await Branch.findAccessibleForUser(userId, branchId, { allowedStatuses: ['active'] }))
      throw new DomainError('The requester no longer has access to this branch.', 403);
  }
  async function read(id, branchId) {
    const batch = (await pool.query(`SELECT id,status,message,created_at,updated_at,user_id FROM catalog_workspace.ai_batches WHERE id=$1 AND branch_id=$2`, [id,branchId])).rows[0];
    if (!batch) throw DomainError.notFound('AI batch not found in this branch.');
    batch.items = (await pool.query(`SELECT e.id,e.item_id,e.state,e.message,e.updated_at,COALESCE(i.name,'Unnamed lot') AS name
      FROM catalog_workspace.ai_batch_items e JOIN inventory.items i ON i.id=e.item_id WHERE e.batch_id=$1 ORDER BY e.ordinal`, [id])).rows;
    return batch;
  }
  async function list(branchId) {
    return { batches: (await pool.query(`SELECT b.id,b.status,b.message,b.created_at,b.updated_at,
      count(e.id)::int AS total,count(e.id) FILTER(WHERE e.state IN ('done','skipped'))::int AS completed
      FROM catalog_workspace.ai_batches b JOIN catalog_workspace.ai_batch_items e ON e.batch_id=b.id
      WHERE b.branch_id=$1 GROUP BY b.id ORDER BY (b.status<>'done') DESC,b.created_at DESC LIMIT 30`, [branchId])).rows };
  }
  /** Idempotent acceptance reserves every selected item atomically before acknowledging background execution. */
  async function submit({ itemIds, submissionKey, userId, branchId }) {
    requireHostProtocol();
    await assertRequesterAccess(userId, branchId);
    if (!extractor.isCatalogAiEnabled() || !process.env.OPENAI_API_KEY) throw new DomainError('AI fill is not configured.', 503);
    const id = await queueTransaction(async client => {
      const existing = (await client.query(`SELECT id,item_ids FROM catalog_workspace.ai_batches
        WHERE user_id=$1 AND branch_id=$2 AND submission_key=$3`, [userId,branchId,submissionKey])).rows[0];
      if (existing) {
        if (JSON.stringify(existing.item_ids) !== JSON.stringify(itemIds)) throw DomainError.conflict('Submission key already belongs to a different selection.');
        return existing.id;
      }
      const unfinished = await client.query(`SELECT count(*)::int AS count FROM catalog_workspace.ai_batches
        WHERE user_id=$1 AND status<>'done'`, [userId]);
      if (unfinished.rows[0].count >= 10) throw new DomainError('Finish or resume your existing AI batches before adding more. Up to 10 unfinished batches are allowed.',429);
      const rows = (await client.query(`SELECT i.id,i.pos_product_id,i.pos_sync_status,i.image_path,
        EXISTS(SELECT 1 FROM inventory.intake_cancellations c WHERE c.item_id=i.id AND c.restored_at IS NULL) AS cancelled,
        (SELECT j.status FROM inventory.item_jobs j WHERE j.item_id=i.id AND j.job_type='ai_fill' ORDER BY j.created_at DESC,j.id DESC LIMIT 1) AS ai_status
        FROM inventory.items i WHERE i.id=ANY($1::uuid[]) AND i.branch_id=$2 ORDER BY i.id FOR UPDATE`, [itemIds,branchId])).rows;
      if (rows.length !== itemIds.length) throw DomainError.notFound('Some selected photos are unavailable in this branch.');
      const reserved = await client.query(`SELECT 1 FROM catalog_workspace.ai_batch_items WHERE item_id=ANY($1::uuid[]) AND state IN ('queued','running','attention') LIMIT 1`, [itemIds]);
      if (reserved.rowCount || rows.some(row => row.ai_status === 'running')) throw DomainError.conflict('Some photos already have AI work. Open Background AI fill to check saved progress.');
      const id = randomUUID();
      await client.query(`INSERT INTO catalog_workspace.ai_batches(id,branch_id,user_id,submission_key,item_ids) VALUES($1,$2,$3,$4,$5)`, [id,branchId,userId,submissionKey,itemIds]);
      for (const [ordinal,itemId] of itemIds.entries()) {
        const row = rows.find(candidate => candidate.id === itemId);
        const reason = row.cancelled ? 'Intake cancelled' : row.pos_product_id || row.pos_sync_status === 'synced' ? 'Already received' : !row.image_path ? 'Photo unavailable' : row.ai_status === 'succeeded' ? 'Already filled' : '';
        await client.query(`INSERT INTO catalog_workspace.ai_batch_items(batch_id,item_id,ordinal,state,message) VALUES($1,$2,$3,$4,$5)`, [id,itemId,ordinal,reason?'skipped':'queued',reason||'Queued']);
      }
      await audit(client, userId, 'submit', id);
      return id;
    });
    await settleBatches();
    return read(id,branchId);
  }
  async function audit(client, userId, action, id) {
    await client.query(`INSERT INTO user_audit_logs(user_id,action,module,description) VALUES($1,$2,'catalog',$3)`, [userId,`catalog.ai.batch.${action}`,JSON.stringify({batch_id:id})]);
  }
  /** Stop preserves queued intent; resume never retries an uncertain paid attempt without explicit consent. */
  async function change({ id, branchId, userId, action, confirmRetry }) {
    await queueTransaction(async client => {
      const batch = (await client.query(`SELECT * FROM catalog_workspace.ai_batches WHERE id=$1 AND branch_id=$2 FOR UPDATE`, [id,branchId])).rows[0];
      if (!batch) throw DomainError.notFound('AI batch not found in this branch.');
      if (action === 'stop') {
        await client.query(`UPDATE catalog_workspace.ai_batches SET status='stopped',message='Stopped. The current photo may finish.',updated_at=now() WHERE id=$1 AND status<>'done'`, [id]);
      } else {
        await assertRequesterAccess(batch.user_id,branchId);
        const attention = await client.query(`SELECT 1 FROM catalog_workspace.ai_batch_items WHERE batch_id=$1 AND state='attention'`, [id]);
        if (attention.rowCount && !confirmRetry) throw DomainError.conflict('Review saved results and explicitly confirm retrying unresolved photos. A retry may incur another AI charge.');
        await client.query(`UPDATE catalog_workspace.ai_batch_items SET state='queued',message='Queued for explicit retry',claim_token=NULL,lease_until=NULL,job_id=NULL,usage_id=NULL,updated_at=now() WHERE batch_id=$1 AND state='attention'`, [id]);
        await client.query(`UPDATE catalog_workspace.ai_batches SET status='active',message='',updated_at=now() WHERE id=$1 AND status<>'done'`, [id]);
      }
      await audit(client,userId,action,id);
    });
    await settleBatches();
    return read(id,branchId);
  }
  async function settleBatches() {
    await pool.query(`UPDATE catalog_workspace.ai_batches b SET status='done',message='Finished. Review the saved details.',updated_at=now()
      WHERE b.status<>'done' AND NOT EXISTS(SELECT 1 FROM catalog_workspace.ai_batch_items e WHERE e.batch_id=b.id AND e.state IN ('queued','running','attention'))`);
  }
  /** Expired linked attempts become attention cases; unstarted claims can safely return to the queue. */
  async function recoverExpired() {
    await queueTransaction(async client => {
      const expired = (await client.query(`SELECT id,item_id FROM catalog_workspace.ai_batch_items WHERE state='running' AND lease_until<now()`)).rows;
      for (const row of expired) {
        await client.query('SELECT id FROM inventory.items WHERE id=$1 FOR UPDATE', [row.item_id]);
        const entry = (await client.query(`SELECT e.*,j.status AS job_status FROM catalog_workspace.ai_batch_items e
          LEFT JOIN inventory.item_jobs j ON j.id=e.job_id WHERE e.id=$1 AND e.state='running' AND e.lease_until<now() FOR UPDATE OF e`, [row.id])).rows[0];
        if (!entry) continue;
        const state = entry.job_status === 'succeeded' ? 'done' : entry.job_id ? 'attention' : 'queued';
        if (state === 'attention') {
          await client.query(`UPDATE inventory.item_jobs SET status='failed',error_category='interrupted',error_message='Background worker interrupted; reconcile before retry.',updated_at=now(),resolved_at=now() WHERE id=$1 AND status='running'`, [entry.job_id]);
          await client.query(`UPDATE catalog_workspace.ai_batches SET status='paused',message='An attempt was interrupted. Check saved details before retrying.',updated_at=now() WHERE id=$1 AND status='active'`, [entry.batch_id]);
        }
        await client.query(`UPDATE catalog_workspace.ai_batch_items SET state=$2,claim_token=NULL,lease_until=NULL,message=$3,updated_at=now() WHERE id=$1`, [entry.id,state,state==='attention'?'Outcome uncertain. Review before paid retry.':state==='done'?'Ready to review':'Queued after restart']);
      }
    });
    await settleBatches();
  }
  /** Claim one photo globally, retaining persisted leases across process and database connection loss. */
  async function claimNext() {
    return queueTransaction(async client => {
      if ((await client.query(`SELECT 1 FROM catalog_workspace.ai_batch_items WHERE state='running' LIMIT 1`)).rowCount) return null;
      const entry = (await client.query(`SELECT e.*,b.user_id,b.branch_id FROM catalog_workspace.ai_batch_items e
        JOIN catalog_workspace.ai_batches b ON b.id=e.batch_id WHERE e.state='queued' AND b.status='active'
        ORDER BY b.updated_at,b.created_at,e.ordinal LIMIT 1 FOR UPDATE OF e,b`)).rows[0];
      if (!entry) return null;
      entry.token = randomUUID();
      await client.query(`UPDATE catalog_workspace.ai_batch_items SET state='running',message='Reading photo',claim_token=$2,lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1`, [entry.id,entry.token]);
      return entry;
    });
  }
  /** A tick owns only one extraction; provider failures pause rather than triggering paid background retries. */
  async function runOne() {
    requireHostProtocol();
    await recoverExpired();
    const entry = await claimNext();
    if (!entry) return false;
    let heartbeat;
    try {
      await assertRequesterAccess(entry.user_id,entry.branch_id);
      const eligible = (await pool.query(`SELECT i.pos_product_id,i.pos_sync_status,i.image_path,
        EXISTS(SELECT 1 FROM inventory.intake_cancellations c WHERE c.item_id=i.id AND c.restored_at IS NULL) AS cancelled,
        EXISTS(SELECT 1 FROM inventory.item_jobs j WHERE j.item_id=i.id AND j.job_type='ai_fill' AND j.status='succeeded') AS filled
        FROM inventory.items i WHERE i.id=$1 AND i.branch_id=$2`, [entry.item_id,entry.branch_id])).rows[0];
      if (!eligible || !eligible.image_path || eligible.cancelled || eligible.pos_product_id || eligible.pos_sync_status==='synced' || eligible.filled) {
        await pool.query(`UPDATE catalog_workspace.ai_batch_items SET state='skipped',message='Already filled, received, cancelled or unavailable',lease_until=NULL,updated_at=now() WHERE id=$1 AND claim_token=$2 AND state='running'`, [entry.id,entry.token]);
        return true;
      }
      heartbeat = setInterval(() => {
        pool.query(`UPDATE catalog_workspace.ai_batch_items SET lease_until=now()+interval '2 minutes' WHERE id=$1 AND claim_token=$2 AND state='running' AND lease_until>now()`, [entry.id,entry.token]).catch(() => {});
      }, 10000);
      heartbeat.unref();
      await extractor.extractCatalogItem({itemId:entry.item_id,branchId:entry.branch_id,userId:entry.user_id,queueClaim:{id:entry.id,token:entry.token}});
    } catch (error) {
      await queueTransaction(async client => {
        const saved = (await client.query(`SELECT state,job_id FROM catalog_workspace.ai_batch_items WHERE id=$1 AND claim_token=$2 FOR UPDATE`, [entry.id,entry.token])).rows[0];
        if (!saved || saved.state !== 'running') return;
        if (saved.job_id) await client.query(`UPDATE inventory.item_jobs SET status='failed',error_category='interrupted',
          error_message='Review saved outcome before retrying.',updated_at=now(),resolved_at=now() WHERE id=$1 AND status='running'`, [saved.job_id]);
        const message = error.statusCode === 429 ? 'AI usage limit reached. Resume later.' : error.statusCode === 403 ? 'Requester access changed. Restore access before resuming.' : 'AI fill could not finish. Review saved details before retrying.';
        await client.query(`UPDATE catalog_workspace.ai_batch_items SET state=$3,message=$4,lease_until=NULL,updated_at=now() WHERE id=$1 AND claim_token=$2`, [entry.id,entry.token,saved.job_id?'attention':'queued',message]);
        await client.query(`UPDATE catalog_workspace.ai_batches SET status='paused',message=$2,updated_at=now() WHERE id=$1 AND status='active'`, [entry.batch_id,message]);
      });
    } finally {
      clearInterval(heartbeat);
      await settleBatches();
      await pool.query(`UPDATE catalog_workspace.ai_batches SET updated_at=now() WHERE id=$1`, [entry.batch_id]);
    }
    return true;
  }
  return { submit, read, list, change, runOne, recoverExpired, assertRequesterAccess };
}

const workers = new WeakMap();
/** Start once per host pool; timers merely wake durable work and are never the source of queue state. */
function startAiBatchWorker(dependencies) {
  const { pool } = dependencies.source('config/database');
  if (workers.has(pool)) return workers.get(pool);
  const service = createAiBatchService(dependencies);
  let stopped = false, timer, pending;
  async function tick() {
    if (stopped) return;
    try { pending = service.runOne(); await pending; }
    catch (error) { console.error('Background AI queue check failed:', error.code || error.name); }
    finally { if (!stopped) { timer = setTimeout(tick,2000); timer.unref(); } }
  }
  const worker = { stop() { stopped=true; clearTimeout(timer); return pending; } };
  workers.set(pool,worker);
  process.once('SIGTERM', () => worker.stop());
  process.once('SIGINT', () => worker.stop());
  timer = setTimeout(tick,2000); timer.unref();
  return worker;
}
module.exports = { createAiBatchService, startAiBatchWorker };
