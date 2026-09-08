/** Remove only the owner-identified cancelled test delivery; retain its photo and audit evidence. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const requirePos = createRequire('C:/Projects/Inventory POS release check/backend/package.json');
const source = JSON.parse(fs.readFileSync(path.join(root, '.test-data/production-db-private.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(source.RAILWAY_PROJECT_ID, 'f06ae302-c116-487a-96d6-4a76a387e533');
assert.equal(source.RAILWAY_SERVICE_ID, '26829259-55d6-447c-89bf-0474e71edc1f');
const apply = process.argv.includes('--apply');
const pool = new (requirePos('pg').Pool)({host:'autorack.proxy.rlwy.net',port:10669,
  database:source.PGDATABASE,user:source.PGUSER,password:source.PGPASSWORD,
  ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:20000});
async function removeVerificationDelivery() {
  // Lock and assert exact identity and cancellation state before removing only organization rows.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const batches = (await client.query('SELECT * FROM catalog_workspace.batches WHERE title=$1 AND branch_id=$2 FOR UPDATE',
      ['Production upload verification - 7 Sep 2026 - not stock','d2622a5b-6397-47c7-9ee3-3d28bcec76c8'])).rows;
    assert.equal(batches.length,1);
    const batch=batches[0];
    const members=(await client.query('SELECT * FROM catalog_workspace.batch_items WHERE batch_id=$1 FOR UPDATE',[batch.id])).rows;
    assert.deepEqual(members.map(row=>row.item_id),['5e28a317-8cee-425a-9da9-96014729a16a']);
    const item=(await client.query('SELECT id,pos_product_id,branch_id FROM inventory.items WHERE id=$1 FOR UPDATE',[members[0].item_id])).rows[0];
    assert.equal(item.pos_product_id,null);
    assert.equal(item.branch_id,batch.branch_id);
    assert.equal((await client.query('SELECT 1 FROM inventory.catalog_publications WHERE item_id=$1',[item.id])).rowCount,0);
    assert.equal((await client.query('SELECT 1 FROM inventory.intake_cancellations WHERE item_id=$1 AND restored_at IS NULL',[item.id])).rowCount,1);
    if(apply) {
      const folder=path.join(process.env.LOCALAPPDATA,'KLineMigrationEvidence','verification-delivery-removal');
      fs.mkdirSync(folder,{recursive:true});
      fs.writeFileSync(path.join(folder,`${batch.id}.json`),JSON.stringify({batch,members},null,2));
      await client.query('DELETE FROM catalog_workspace.batch_items WHERE batch_id=$1',[batch.id]);
      await client.query('DELETE FROM catalog_workspace.batches WHERE id=$1',[batch.id]);
      await client.query("INSERT INTO user_audit_logs(user_id,action,module,description) VALUES($1,'catalog.verification_delivery_removed','catalog',$2)",
        [batch.created_by,JSON.stringify({batch_id:batch.id,title:batch.title,item_id:item.id,reason:'Owner requested removal of production verification delivery',retained_cancelled_intake:true})]);
      await client.query('COMMIT');
    } else await client.query('ROLLBACK');
    const report={checked_at:new Date().toISOString(),passed:true,removed:apply,batch_id:batch.id,cancelled_intake_retained:true,stock_changed:false};
    if(apply)fs.writeFileSync(path.join(root,'verification/production-verification-delivery-removal.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {client.release();await pool.end();}
}
removeVerificationDelivery().catch(error=>{console.error(error.message);process.exitCode=1;});
