const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const {configureTestEnvironment}=require('./environment.cjs');
const {installLocalImageStore}=require('./local-images.cjs');
/** Exercise batch transactions, scoped reads and source-photo repair against the real isolated POS HTTP stack. */
async function verifyBulkPreparationApi(){
 const dependencies=configureTestEnvironment();installLocalImageStore(dependencies);
 const {pool}=dependencies.source('config/database');
 const host=require('../local-host.cjs').createLocalHost(dependencies).listen(0,'127.0.0.1');
 await new Promise(resolve=>host.on('listening',resolve));
 const base=`http://127.0.0.1:${host.address().port}/api`;
 const branch='00000000-0000-4000-b111-000000000001',category='00000000-0000-4000-0300-000000000001';
 const checks=[];let token='';
 async function call(route,body,method=body?'POST':'GET',expected=200,branchId=branch,auth=token){
  const response=await fetch(base+route,{method,headers:{Authorization:`Bearer ${auth}`,'X-Branch-Id':branchId,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
  const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;
 }
 try{
  token=(await call('/auth/login',{username:'testadmin',password:'testpass123'})).token;
  const bytes=await fs.readFile('design/assets/item-0.jpg');const ids=[randomUUID(),randomUUID(),randomUUID()];
  for(const id of ids){const form=new FormData();form.set('id',id);form.set('category_id',category);form.set('status','draft');form.set('image',new Blob([bytes],{type:'image/jpeg'}),'fixture.jpg');await call('/catalog/items',form,'POST',201);}
  let loaded=await call('/catalog-workspace/preparation/read',{item_ids:ids});
  assert.equal(loaded.results.length,3);assert(loaded.results.every(row=>row.detail&&!JSON.stringify(row.detail).includes('base_cost_price')));
  const changes=loaded.results.map(row=>({id:row.id,payload:{expected_revision:row.detail.revision,name:'Bulk API shirt',brand:'Batch',category_id:category,attributes:{material:'Cotton'}}}));
  changes[1].payload.expected_revision='0'.repeat(64);
  const saved=await call('/catalog-workspace/preparation/save',{mode:'details',rows:changes});
  assert(saved.results[0].saved);assert(saved.results[1].error);assert(!saved.results[1].saved);assert(saved.results[2].saved);
  checks.push('A stale lot fails independently while valid details commit with fresh snapshots');
  await call('/catalog-workspace/preparation/read',{item_ids:[ids[0],ids[0]]},'POST',400);
  await call('/catalog-workspace/preparation/read',{item_ids:ids},'POST',401,branch,'');
  const otherBranch=(await pool.query('SELECT id FROM branches WHERE id<>$1 AND status=$2 LIMIT 1',[branch,'active'])).rows[0].id;
  const scoped=await call('/catalog-workspace/preparation/read',{item_ids:ids},'POST',200,otherBranch);
  assert(scoped.results.every(row=>row.error&&!row.detail));
  checks.push('Batch reads enforce authentication, distinct IDs and branch isolation');
  const before=(await pool.query('SELECT * FROM inventory.items WHERE id=$1',[ids[0]])).rows[0];
  const photo=()=>{const form=new FormData();form.set('image',new Blob([bytes],{type:'image/jpeg'}),'repair.jpg');form.set('expected_revision',saved.results[0].detail.revision);return form;};
  await call(`/catalog-workspace/items/${ids[0]}/source-photo`,photo(),'POST',404,otherBranch);
  await call(`/catalog-workspace/items/${ids[0]}/source-photo`,photo());
  const retry=await call(`/catalog-workspace/items/${ids[0]}/source-photo`,photo());assert(retry.already_saved);
  const after=(await pool.query('SELECT * FROM inventory.items WHERE id=$1',[ids[0]])).rows[0];
  assert.notEqual(after.image_path,before.image_path);assert.equal(after.stock_quantity,before.stock_quantity);assert.deepEqual(after.attributes,before.attributes);
  assert.equal((await fs.readFile(`.test-data/images/${before.image_path}`)).length,bytes.length);
  checks.push('Batch photo assignment preserves old bytes, stock and attributes; same-photo retry is idempotent');
  const detail=(await call('/catalog-workspace/preparation/read',{item_ids:ids})).results;
  const counts=detail.map(row=>({id:row.id,payload:{expected_revision:row.detail.revision,entries:[{variant_attributes:{size:'M'},quantity:2}]}}));
  counts[1].payload.entries[0].quantity=0;
  const confirmed=await call('/catalog-workspace/preparation/save',{mode:'counts',rows:counts});
  assert.equal(confirmed.results[0].detail.item.stock_quantity,2);assert(confirmed.results[1].error);assert.equal(confirmed.results[2].detail.item.stock_distribution_source,'human_confirmed');
  const repeated=await call('/catalog-workspace/preparation/save',{mode:'counts',rows:counts});assert(repeated.results.every(row=>row.error));
  checks.push('Count validation isolates bad quantities and stale retry cannot change saved counts');
  const user=(await pool.query("SELECT id FROM users WHERE username='testcashier'")).rows[0];
  const permission=(await pool.query("SELECT id FROM permissions WHERE name='catalog.edit'")).rows[0];
  const prior=(await pool.query('SELECT * FROM user_permissions WHERE user_id=$1 AND permission_id=$2',[user.id,permission.id])).rows[0];
  try{
   await pool.query('INSERT INTO user_permissions(user_id,permission_id,granted) VALUES($1,$2,false) ON CONFLICT(user_id,permission_id) DO UPDATE SET granted=false',[user.id,permission.id]);
   const cashier=(await call('/auth/login',{username:'testcashier',password:'testpass123'})).token;
   await call('/catalog-workspace/preparation/save',{mode:'counts',rows:counts},'POST',403,branch,cashier);
   await call(`/catalog-workspace/items/${ids[1]}/source-photo`,photo(),'POST',403,branch,cashier);
  }finally{
   if(prior)await pool.query('UPDATE user_permissions SET granted=$3 WHERE user_id=$1 AND permission_id=$2',[user.id,permission.id,prior.granted]);
   else await pool.query('DELETE FROM user_permissions WHERE user_id=$1 AND permission_id=$2',[user.id,permission.id]);
  }
  checks.push('Read-only staff cannot use batch saving or source-photo repair to bypass edit permission');
  await fs.writeFile('verification/bulk-preparation-api.json',JSON.stringify({passed:true,database:process.env.DB_NAME,checks},null,2));console.log(JSON.stringify({passed:true,checks}));
 }finally{await new Promise(resolve=>host.close(resolve));await pool.end();}
}
verifyBulkPreparationApi().catch(error=>{console.error(error);process.exitCode=1;});
