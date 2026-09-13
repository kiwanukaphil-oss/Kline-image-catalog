const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { fork } = require('node:child_process');

/** Exercise accepted intent, ownership, paid retry boundaries and restart recovery against real local PostgreSQL. */
async function verifyBackgroundAi() {
  const dependencies = require('./environment.cjs').configureTestEnvironment();
  require('./local-images.cjs').installLocalImageStore(dependencies);
  process.env.CATALOG_AI_ENABLED='true'; process.env.OPENAI_API_KEY='local-fixture-not-a-real-key'; process.env.OPENAI_MAX_ATTEMPTS='1';
  process.env.CATALOG_AI_RATE_PER_HOUR='10000'; process.env.CATALOG_AI_RATE_PER_DAY='10000';
  let providerCalls=0, fail=false, releaseFirstProvider, notifyFirstProvider;
  const firstProviderStarted=new Promise(resolve=>{notifyFirstProvider=resolve;});
  const firstProviderGate=new Promise(resolve=>{releaseFirstProvider=resolve;});
  const restoreProvider=require('./ai-batch-provider.cjs').installBatchProvider({delay:60,onCall:()=>providerCalls++,shouldFail:()=>fail,beforeResponse:async()=>{if(providerCalls===1){notifyFirstProvider();await firstProviderGate;}}});
  const { pool }=dependencies.source('config/database');
  const service=require('../ai-batches.cjs').createAiBatchService(dependencies);
  const secondWorker=require('../ai-batches.cjs').createAiBatchService(dependencies);
  const host=require('../local-host.cjs').createLocalHost(dependencies).listen(0,'127.0.0.1');
  await new Promise(resolve=>host.on('listening',resolve));
  const base=`http://127.0.0.1:${host.address().port}/api`;
  const branch='00000000-0000-4000-b111-000000000001', category='00000000-0000-4000-0300-000000000001';
  const actor=(await pool.query("SELECT id FROM users WHERE username='testadmin'")).rows[0].id;
  const batchIds=[],checks=[];
  let token='', child;
  async function call(route,body,status=200,auth=token,branchId=branch) {
    const response=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${auth}`,'X-Branch-Id':branchId,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json(); assert.equal(response.status,status,JSON.stringify(result)); return result;
  }
  async function photo() {
    const id=randomUUID();
    await pool.query(`INSERT INTO inventory.items(id,category_id,branch_id,name,brand,status,image_path,attributes,stock_quantity,stock_distribution_source,created_by,updated_by)
      VALUES($1,$2,$3,'Staff name','Staff brand','draft',$4,$5,1,'human_confirmed',$6,$6)`,[id,category,branch,`trousers/${id}.jpg`,{color:'Blue'},actor]);
    await pool.query(`INSERT INTO inventory.item_variant_lines(id,item_id,position,variant_key,variant_attributes,quantity,updated_by) VALUES($1,$2,0,'L',$3,1,$4)`,[randomUUID(),id,{size:'L'},actor]);
    return id;
  }
  async function submit(ids) {
    const batch=await call('/catalog-workspace/ai-batches',{item_ids:ids,submission_key:randomUUID()});batchIds.push(batch.id);return batch;
  }
  const pass=message=>{checks.push(message);console.log('PASS',message);};
  try {
    token=(await call('/auth/login',{username:'testadmin',password:'testpass123'})).token;
    const ids=[await photo(),await photo(),await photo()], key=randomUUID();
    const batch=await call('/catalog-workspace/ai-batches',{item_ids:ids,submission_key:key});batchIds.push(batch.id);
    assert.equal((await call('/catalog-workspace/ai-batches',{item_ids:ids,submission_key:key})).id,batch.id);
    await call('/catalog-workspace/ai-batches',{item_ids:[ids[0]],submission_key:key},409);
    await call('/catalog-workspace/ai-batches',{item_ids:[ids[0]],submission_key:randomUUID()},409);
    await call(`/catalog/items/${ids[0]}/ai-extract`,{only_empty:true},409);
    await call(`/catalog-workspace/ai-batches/${batch.id}`,null,401,'');
    await call(`/catalog-workspace/ai-batches/${batch.id}`,null,400,token,randomUUID());
    assert.equal(providerCalls,0);pass('Idempotent acceptance, overlap and legacy endpoint protection; authenticated branch scope');
    // Hold the first provider call open to test simultaneous workers without depending on scheduler timing.
    const firstWorker=service.runOne();
    await firstProviderStarted;
    await secondWorker.runOne();
    releaseFirstProvider();
    await firstWorker;
    assert.equal((await service.read(batch.id,branch)).items.filter(item=>item.state==='done').length,1);
    await call(`/catalog-workspace/ai-batches/${batch.id}/stop`,{});
    const beforeStop=providerCalls; await service.runOne();assert.equal(providerCalls,beforeStop);
    await call(`/catalog-workspace/ai-batches/${batch.id}/resume`,{});
    await service.runOne();await service.runOne();
    assert.equal((await service.read(batch.id,branch)).status,'done');
    const saved=(await pool.query('SELECT name,brand,attributes,stock_quantity,stock_distribution_source FROM inventory.items WHERE id=$1',[ids[0]])).rows[0];
    assert.equal(saved.name,'Staff name');assert.equal(saved.brand,'Staff brand');assert.equal(saved.attributes.color,'Blue');assert.equal(saved.stock_distribution_source,'human_confirmed');assert.equal(saved.stock_quantity,1);
    pass('Two workers claim once; stop/resume retains queued work; saved human fields and counts protected');
    const beforeReplay=providerCalls;await call('/catalog-workspace/ai-batches',{item_ids:ids,submission_key:key});await service.runOne();assert.equal(providerCalls,beforeReplay);
    pass('Lost acknowledgement replay does not repeat completed inference');
    const failed=await submit([await photo(),await photo()]);fail=true;await service.runOne();fail=false;
    assert.equal((await service.read(failed.id,branch)).status,'paused');
    const beforeRetry=providerCalls;await service.runOne();assert.equal(providerCalls,beforeRetry);
    await call(`/catalog-workspace/ai-batches/${failed.id}/resume`,{},409);
    await call(`/catalog-workspace/ai-batches/${failed.id}/resume`,{confirm_retry:true});
    await service.runOne();await service.runOne();assert.equal((await service.read(failed.id,branch)).status,'done');
    pass('Provider failures pause remaining work; explicit paid retry required');
    const limited=await submit([await photo()]);process.env.CATALOG_AI_RATE_PER_HOUR='1';
    const beforeLimit=providerCalls;await service.runOne();assert.equal(providerCalls,beforeLimit);assert.equal((await service.read(limited.id,branch)).status,'paused');
    process.env.CATALOG_AI_RATE_PER_HOUR='10000';await call(`/catalog-workspace/ai-batches/${limited.id}/resume`,{});await service.runOne();
    pass('Durable usage caps pause without provider calls and allow later resume');
    const revoked=await submit([await photo()]);
    await pool.query('UPDATE users SET is_active=false WHERE id=$1',[actor]);
    const beforeRevoked=providerCalls;await service.runOne();assert.equal(providerCalls,beforeRevoked);
    await pool.query('UPDATE users SET is_active=true WHERE id=$1',[actor]);
    await call(`/catalog-workspace/ai-batches/${revoked.id}/resume`,{});await service.runOne();pass('Requester deactivation pauses queued work');
    const cancelledId=await photo(),cancelled=await submit([cancelledId]);
    await pool.query(`INSERT INTO inventory.intake_cancellations(item_id,branch_id,cancelled_by,reason) VALUES($1,$2,$3,'Fixture cancellation')`,[cancelledId,branch,actor]);
    const beforeCancel=providerCalls;await service.runOne();assert.equal(providerCalls,beforeCancel);assert.equal((await service.read(cancelled.id,branch)).items[0].state,'skipped');pass('Cancellation before execution skips inference');
    const interrupted=await submit([await photo(),await photo()]);
    child=fork(require.resolve('./ai-batch-worker-child.cjs'),[],{env:process.env,stdio:['ignore','ignore','inherit','ipc']});
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Worker did not reach provider')),15000);child.once('message',()=>{clearTimeout(timeout);resolve();});child.once('error',reject);});
    child.kill();await new Promise(resolve=>child.once('exit',resolve));child=null;
    await pool.query(`UPDATE catalog_workspace.ai_batch_items SET lease_until=now()-interval '1 second' WHERE batch_id=$1 AND state='running'`,[interrupted.id]);
    const beforeRecovery=providerCalls;await service.recoverExpired();
    let recovered=await service.read(interrupted.id,branch);assert.equal(recovered.items[0].state,'attention');assert.equal(recovered.items[1].state,'queued');assert.equal(providerCalls,beforeRecovery);
    await call(`/catalog-workspace/ai-batches/${interrupted.id}/resume`,{},409);
    const fenced=(await pool.query('SELECT job_id,usage_id,item_id FROM catalog_workspace.ai_batch_items WHERE id=$1',[recovered.items[0].id])).rows[0];
    await assert.rejects(dependencies.source('models/CatalogAiRun').completeSuccess({itemId:fenced.item_id,branchId:branch,userId:actor,jobId:fenced.job_id,usageId:fenced.usage_id,candidateValues:{material:'Late result'}}));
    await call(`/catalog-workspace/ai-batches/${interrupted.id}/resume`,{confirm_retry:true});await service.runOne();await service.runOne();
    pass('Real worker process termination preserves queue; uncertain attempt requires consent and late results are fenced');
    const unstarted=await submit([await photo()]);
    await pool.query(`UPDATE catalog_workspace.ai_batch_items SET state='running',claim_token=$2,lease_until=now()-interval '1 second' WHERE batch_id=$1`,[unstarted.id,randomUUID()]);
    await service.recoverExpired();assert.equal((await service.read(unstarted.id,branch)).items[0].state,'queued');await service.runOne();
    pass('Restart before attempt linkage safely requeues without an uncertain paid retry');
    const persisted=await submit([await photo()]);
    const realExtractor=dependencies.source('services/catalogAiExtractionService');
    const interruptedBookkeeping=require('../ai-batches.cjs').createAiBatchService({...dependencies,source(relative) {
      if (relative !== 'services/catalogAiExtractionService') return dependencies.source(relative);
      return {...realExtractor,async extractCatalogItem(input) { await realExtractor.extractCatalogItem(input); throw Error('Fixture: lost worker completion acknowledgement'); }};
    }});
    await interruptedBookkeeping.runOne();assert.equal((await service.read(persisted.id,branch)).status,'done');
    const beforeReconcile=providerCalls;await secondWorker.runOne();assert.equal(providerCalls,beforeReconcile);
    pass('Extraction result and queue completion commit together; lost bookkeeping cannot repeat paid inference');
    const cashier=(await pool.query("SELECT id FROM users WHERE username='testcashier'")).rows[0].id;
    const editPermission=(await pool.query("SELECT id FROM permissions WHERE name='catalog.edit'")).rows[0].id;
    const permissionBefore=(await pool.query('SELECT granted FROM user_permissions WHERE user_id=$1 AND permission_id=$2',[cashier,editPermission])).rows[0];
    const permissionBatch=await service.submit({itemIds:[await photo()],submissionKey:randomUUID(),userId:cashier,branchId:branch});batchIds.push(permissionBatch.id);
    try {
      await pool.query('INSERT INTO user_permissions(user_id,permission_id,granted) VALUES($1,$2,false) ON CONFLICT(user_id,permission_id) DO UPDATE SET granted=false',[cashier,editPermission]);
      const beforePermission=providerCalls;await service.runOne();assert.equal(providerCalls,beforePermission);assert.equal((await service.read(permissionBatch.id,branch)).status,'paused');
    } finally {
      if (permissionBefore) await pool.query('UPDATE user_permissions SET granted=$3 WHERE user_id=$1 AND permission_id=$2',[cashier,editPermission,permissionBefore.granted]);
      else throw Error('Expected seeded explicit cashier edit grant; preserve unexpected fixture state for inspection.');
    }
    await service.change({id:permissionBatch.id,branchId:branch,userId:actor,action:'resume'});await service.runOne();
    await assert.rejects(service.read(permissionBatch.id,randomUUID()),error=>error.statusCode===404);
    pass('Effective permission revocation pauses execution; batch reads cannot cross branches');
    const receivedId=await photo(),receivedBatch=await submit([receivedId]);
    await pool.query("UPDATE inventory.items SET pos_sync_status='synced' WHERE id=$1",[receivedId]);
    const beforeReceived=providerCalls;await service.runOne();assert.equal(providerCalls,beforeReceived);assert.equal((await service.read(receivedBatch.id,branch)).items[0].state,'skipped');
    pass('Publication after queue acceptance prevents later inference');
    fs.writeFileSync('verification/ai-batches-integration.json',JSON.stringify({checked_at:new Date().toISOString(),checks,provider_calls:providerCalls,paid_provider_calls:0,production_changed:false},null,2));
  } finally {
    releaseFirstProvider();
    child?.kill();
    await pool.query('UPDATE users SET is_active=true WHERE id=$1',[actor]);
    await pool.query(`UPDATE catalog_workspace.ai_batch_items SET state='skipped',lease_until=NULL WHERE batch_id=ANY($1::uuid[]) AND state IN ('queued','running','attention')`,[batchIds]);
    await pool.query(`UPDATE catalog_workspace.ai_batches SET status='done' WHERE id=ANY($1::uuid[])`,[batchIds]);
    restoreProvider();await new Promise(resolve=>host.close(resolve));await pool.end();
  }
}
verifyBackgroundAi().catch(error=>{console.error(error);process.exitCode=1;});
