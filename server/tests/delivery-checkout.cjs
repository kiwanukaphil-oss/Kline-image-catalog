const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');
const {configureTestEnvironment}=require('./environment.cjs');
/** Verify the real pricing-to-stock journey, stale snapshots, linked groups and safe retries in local PostgreSQL. */
async function verifyDelivery(){
 const deps=configureTestEnvironment();require('./local-images.cjs').installLocalImageStore(deps);
 const {pool}=deps.source('config/database');
 const host=require('../local-host.cjs').createLocalHost(deps).listen(0,'127.0.0.1');await new Promise(r=>host.on('listening',r));
 const base=`http://127.0.0.1:${host.address().port}/api`,branch='00000000-0000-4000-b111-000000000001';let token='';const checks=[];
 const actor=(await pool.query("SELECT id FROM users WHERE username='testadmin'")).rows[0].id;
 const category=(await pool.query('SELECT image_category_id FROM inventory.pos_category_map LIMIT 1')).rows[0].image_category_id;
 async function call(route,body,status=200,branchId=branch,auth=token){
  const response=await fetch(base+route,{method:'POST',headers:{Authorization:`Bearer ${auth}`,'X-Branch-Id':branchId,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;
 }
 async function seed(size='M'){
  const id=randomUUID();await pool.query(`INSERT INTO inventory.items(id,category_id,branch_id,name,brand,status,image_path,attributes,stock_quantity,stock_distribution_source,price,created_by,updated_by) VALUES($1,$2,$3,'Checkout shirt','Checkout brand','needs-review','matching-test.jpg','{"color":"Blue","fit":"Slim","material":"Cotton"}',1,'ai_suggested',100000,$4,$4)`,[id,category,branch,actor]);
  await pool.query('INSERT INTO inventory.item_costs(item_id,cost_price,updated_by) VALUES($1,50000,$2)',[id,actor]);
  await pool.query('INSERT INTO inventory.item_variant_lines(id,item_id,position,variant_key,variant_attributes,quantity,updated_by) VALUES($1,$2,0,$3,$4,1,$5)',[randomUUID(),id,size,JSON.stringify({size}),actor]);return id;
 }
 const read=async ids=>(await call('/catalog-workspace/delivery/read',{item_ids:ids})).results.map(r=>{assert(r.item,JSON.stringify(r));return r.item;});
 try{
  token=(await call('/auth/login',{username:'testadmin',password:'testpass123'})).token;
  const a=await seed(),b=await seed('XL');let items=await read([a,b]);
  const rows=items.map(item=>({id:item.id,revision:item.revision,name:item.name,attributes:{},lines:item.lines.map(line=>({...line,quantity:3,price:120000}))}));
  const saved=await call('/catalog-workspace/delivery/save',{rows});assert(saved.results.every(r=>r.item),JSON.stringify(saved));
  assert(saved.results.every(r=>r.item.count_source!=='human_confirmed'));
  let review=(await call('/catalog-workspace/delivery/review',{item_ids:[a,b]})).results;assert(review.every(r=>r.revision),JSON.stringify(review));
  assert(review.every(r=>r.outcome==='New product'));assert(review.every(r=>r.rows[0].quantity===3));
  assert((await read([a,b])).every(i=>i.count_source!=='human_confirmed'));checks.push('Bulk pricing saves proposed quantities; read-only review creates no products or count confirmations');
  await pool.query('UPDATE inventory.items SET name=$2 WHERE id=$1',[b,'Changed checkout shirt']);
  await call('/catalog-workspace/delivery/send',{review:review[1]},409);
  assert.equal((await read([b]))[0].count_source,'ai_suggested');checks.push('Stale summary rejected without confirming counts');
  await Promise.all([call('/catalog-workspace/delivery/send',{review:review[0]}),call('/catalog-workspace/delivery/send',{review:review[0]})]);
  await call('/catalog-workspace/delivery/send',{review:review[0]});
  assert.equal((await pool.query('SELECT count(*)::int n FROM inventory.catalog_publications WHERE item_id=$1',[a])).rows[0].n,1);
  assert.equal((await read([a]))[0].count_source,'human_confirmed');checks.push('Concurrent send and repeated retry produce exactly one receipt and confirm quantities atomically');
  const c=await seed('L'),d=await seed('XXL');
  const plan=await call('/catalog-workspace/product-matches',{item_ids:[c,d],product_name:'Checkout shirt',brand_name:'Checkout brand',variant_defaults:{color:'Blue',fit:'Slim'},review_note:'Same test product',confirm_differences:true});
  const expanded=await call('/catalog-workspace/delivery/read',{item_ids:[c]});assert.equal(expanded.expanded,1);assert.equal(expanded.groups.length,1);
  assert((await call('/catalog-workspace/delivery/review',{item_ids:[c]})).results[0].error);
  const grouped=(await call('/catalog-workspace/delivery/review',{item_ids:[c,d]})).results[0];assert(grouped.revision,JSON.stringify(grouped));assert.equal(grouped.unit.id,plan.id);
  await call('/catalog-workspace/delivery/send',{review:grouped});await call('/catalog-workspace/delivery/send',{review:grouped});
  const publications=(await pool.query('SELECT product_id FROM inventory.catalog_publications WHERE item_id=ANY($1::uuid[])',[[c,d]])).rows;assert.equal(publications.length,2);assert.equal(new Set(publications.map(r=>r.product_id)).size,1);checks.push('Confirmed groups are included together, reviewed without count modal, and received as one product');
  const pending=await seed('XXL');
  const directActor={branchId:branch,userId:actor,canViewCost:true};
  const matching=require('../product-matching.cjs').createProductMatchingService(deps);
  const checkout=require('../delivery-checkout.cjs').createDeliveryCheckout(deps,matching);
  let pendingItem=(await checkout.read([pending],directActor)).results[0].item;
  const priced=await checkout.save({...pendingItem,attributes:{},lines:pendingItem.lines.map(line=>({...line,price:95000,cost:40000,size:'XXL',quantity:2}))},directActor);
  assert.equal(priced.lines[0].size,'2XL');assert.equal(priced.lines[0].cost,40000);
  const staleSave=await call('/catalog-workspace/delivery/save',{rows:[{...pendingItem,lines:pendingItem.lines}]});assert(staleSave.results[0].error);
  const protectedActor={...directActor,canViewCost:false};
  const protectedItem=(await checkout.read([pending],protectedActor)).results[0].item;
  assert(!Object.hasOwn(protectedItem.lines[0],'cost'));
  await assert.rejects(checkout.save({...protectedItem,attributes:{},lines:protectedItem.lines.map(line=>({...line,cost:1}))},protectedActor),/Cost access/);
  const summary=(await checkout.review([pending],directActor)).results[0];assert(summary.revision,JSON.stringify(summary));
  const failingDeps={...deps,source:name=>name==='services/catalogPublicationService'?{...deps.source(name),publishCatalogItem:async({transactionClient})=>{assert(transactionClient);throw Error('Injected stock failure');}}:deps.source(name)};
  const failingCheckout=require('../delivery-checkout.cjs').createDeliveryCheckout(failingDeps,matching);
  await assert.rejects(failingCheckout.send(summary,directActor),/Injected stock failure/);
  assert.equal((await read([pending]))[0].count_source,'ai_suggested');
  assert.equal((await pool.query('SELECT count(*)::int n FROM inventory.catalog_publications WHERE item_id=$1',[pending])).rows[0].n,0);
  checks.push('Cost editing and XXL normalization work; unauthorized costs and stale saves are rejected; a failed publisher rolls back quantity confirmation');
  const other=(await pool.query("SELECT id FROM branches WHERE id<>$1 AND status='active' LIMIT 1",[branch])).rows[0].id;
  const denied=await call('/catalog-workspace/delivery/read',{item_ids:[b]},200,other);assert(denied.results[0].error);
  await call('/catalog-workspace/delivery/read',{item_ids:[b]},401,branch,'');checks.push('Authentication and branch isolation enforced');
  await fs.writeFile('verification/delivery-checkout-api.json',JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks}));
 }finally{await new Promise(r=>host.close(r));await pool.end();}
}
verifyDelivery().catch(error=>{console.error(error);process.exitCode=1;});
