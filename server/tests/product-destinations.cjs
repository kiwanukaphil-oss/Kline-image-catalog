const fs=require('node:fs/promises'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {configureTestEnvironment}=require('./environment.cjs');
/** Verify destination choices against real local HTTP/SQL, including updates which must never book stock. */
async function verifyDestinations(){
 const dependencies=configureTestEnvironment();require('./local-images.cjs').installLocalImageStore(dependencies);
 const {pool}=dependencies.source('config/database'),repository=dependencies.source('repositories/CatalogPublicationRepository');
 const host=require('../local-host.cjs').createLocalHost(dependencies).listen(0,'127.0.0.1');await new Promise(resolve=>host.on('listening',resolve));
 const base=`http://127.0.0.1:${host.address().port}/api`,branch='00000000-0000-4000-b111-000000000001';
 let token='';const checks=[];
 async function call(route,body,expected=200,branchId=branch,auth=token){
  const response=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${auth}`,'X-Branch-Id':branchId,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;
 }
 try{
  token=(await call('/auth/login',{username:'testadmin',password:'testpass123'})).token;
  const userId=(await pool.query("SELECT id FROM users WHERE username='testadmin'")).rows[0].id;
  const map=(await pool.query('SELECT image_category_id,pos_category_id FROM inventory.pos_category_map LIMIT 1')).rows[0];
  const brandName=`Destination ${Date.now()}`,title=brandName,batch=randomUUID();
  await pool.query('INSERT INTO catalog_workspace.batches(id,branch_id,created_by,title) VALUES($1,$2,$3,$4)',[batch,branch,userId,title]);
  const products=await repository.withTransaction(async client=>{
   const brand=await repository.findOrCreateBrand(client,brandName),rows=[];
   for(const color of ['Blue','Navy','Floral'])rows.push(await repository.createProduct(client,{name:`${brandName} ${color}`,description:'Original description',brandId:brand.id,categoryId:map.pos_category_id,basePrice:90000,userId,gender:'unisex',material:'Cotton',masterSku:`DEST-${randomUUID().slice(0,8)}`}));
   return rows;
  });
  const intake=dependencies.source('services/catalogIntakeService'),bytes=await fs.readFile('design/assets/item-0.jpg'),ids=[];
  for(let index=0;index<8;index++){
   const id=randomUUID();ids.push(id);
   await intake.createCatalogItemFromImage({itemId:id,categoryId:map.image_category_id,branchId:branch,userId,brand:brandName,attributes:{},status:'draft',image:{buffer:bytes,mimetype:'image/jpeg',originalname:'source.jpg'}});
   await pool.query("UPDATE inventory.items SET name=$2,attributes=$3 WHERE id=$1",[id,`${brandName} lot ${index+1}`,{size:'M',color:'Blue',fit:'Slim',sleeve:'Short',material:'Cotton'}]);
   await pool.query('INSERT INTO catalog_workspace.batch_items(item_id,batch_id,added_by) VALUES($1,$2,$3)',[id,batch,userId]);
  }
  const fixture={title,ids,products,branch,category:map.image_category_id,targetCategory:map.pos_category_id,brandName};
  if(process.env.SEED_DESTINATIONS_ONLY==='true'){await fs.writeFile('.test-data/destination-fixture.json',JSON.stringify(fixture,null,2));console.log(JSON.stringify({seeded:true,title}));return;}
  const originalPhoto=(await pool.query('SELECT image_path FROM inventory.items WHERE id=$1',[ids[0]])).rows[0].image_path;
  await pool.query('INSERT INTO product_images(product_id,image_path,alt_text,sort_order,is_primary) VALUES($1,$2,$3,0,true)',[products[0].id,originalPhoto,'Original retained photo']);
  await pool.query('UPDATE products SET image_path=$2 WHERE id=$1',[products[0].id,originalPhoto]);
  const load=async (selected=ids)=>(await call('/catalog-workspace/destinations/read',{item_ids:selected})).rows;
  const choices=await call(`/catalog-workspace/destinations/products?category_id=${map.pos_category_id}&search=${encodeURIComponent(brandName)}`);
  assert.equal(choices.length,3);assert(!JSON.stringify(choices).includes('cost_price'));
  let rows=await load();assert.equal(rows.length,8);assert(rows.every(row=>row.revision));
  const operation=(selected,mode,target,patch={})=>({item_ids:selected,mode,target_product_id:target?.id||null,target_version:target?.version,name:'Destination new product',brand:brandName,note:'Explicitly reviewed local fixture design.',patch,source_revisions:Object.fromEntries(rows.filter(row=>selected.includes(row.id)).map(row=>[row.id,row.revision])),group_revisions:Object.fromEntries(rows.filter(row=>selected.includes(row.id)&&row.group).map(row=>[row.group.id,row.group.revision]))});
  const review=async operation=>(await call('/catalog-workspace/destinations/review',{operations:[{key:'test',operation}]})).results[0];
  const apply=async reviewed=>(await call('/catalog-workspace/destinations/apply',{operations:[{key:'test',operation:reviewed.operation,expected_revision:reviewed.revision}]})).results[0];
  const stockBefore=(await pool.query('SELECT count(*)::int n FROM stock_movements')).rows[0].n;
  const sourceBefore=(await pool.query('SELECT id,stock_quantity,stock_distribution_source FROM inventory.items WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows;
  const [blue,navy]=choices;
  const planned=await call('/catalog-workspace/destinations/review',{operations:[{key:'blue',operation:operation([ids[0],ids[1]],'restock',blue)},{key:'navy',operation:operation([ids[2]],'restock',navy)},{key:'new',operation:operation([ids[3]],'new',null)}]});
  assert(planned.results.every(result=>result.review),JSON.stringify(planned));
  const saved=await call('/catalog-workspace/destinations/apply',{operations:planned.results.map(result=>({key:result.key,operation:result.review.operation,expected_revision:result.review.revision}))});
  assert(saved.results.every(result=>result.saved),JSON.stringify(saved));checks.push('Different existing targets and an explicit single-lot new destination save in one batch without stock');
  assert((await apply(planned.results[0].review)).error);checks.push('Lost-acknowledgement retries cannot create duplicate groups');
  rows=await load();assert((await review(operation([ids[0]],'restock',blue))).error);checks.push('Partial existing groups cannot be silently split');
  let update=await review(operation([ids[4]],'update',blue,{name:'Corrected name',description:'Cotton short sleeve shirt',add_photos:true}));assert(update.review,JSON.stringify(update));
  await pool.query('UPDATE products SET description=$2 WHERE id=$1',[blue.id,'Concurrent edit']);
  assert((await apply(update.review)).error);checks.push('Concurrent POS changes invalidate the reviewed update');
  const fresh=(await call(`/catalog-workspace/destinations/products?category_id=${map.pos_category_id}&search=${encodeURIComponent(brandName)}`)).find(product=>product.id===blue.id);
  update=await review(operation([ids[4]],'update',fresh,{name:'Corrected name',description:'Cotton short sleeve shirt',add_photos:true}));assert(update.review,JSON.stringify(update));
  const updated=await apply(update.review);assert(updated.saved,JSON.stringify(updated));
  const target=(await pool.query('SELECT name,description FROM products WHERE id=$1',[blue.id])).rows[0];assert.equal(target.name,'Corrected name');assert.equal(target.description,'Cotton short sleeve shirt');
  assert.equal((await pool.query('SELECT count(*)::int n FROM product_images WHERE product_id=$1',[blue.id])).rows[0].n,2);
  assert.equal((await pool.query('SELECT image_path FROM products WHERE id=$1',[blue.id])).rows[0].image_path,originalPhoto);
  assert.equal((await pool.query('SELECT count(*)::int n FROM inventory.intake_cancellations WHERE item_id=$1 AND restored_at IS NULL',[ids[4]])).rows[0].n,1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM inventory.catalog_publications WHERE item_id=$1',[ids[4]])).rows[0].n,0);
  assert((await apply(update.review)).error);checks.push('Name, description and gallery update archives source intake; no publication or duplicate photo on retry');
  const denied=await dependencies.source('errors/DomainError');
  const service=require('../product-destinations.cjs').createProductDestinationService(dependencies);
  await assert.rejects(service.review({operation:operation([ids[5]],'update',navy,{name:'Denied'}),branchId:branch,userId,canUpdate:false}),error=>error instanceof denied&&error.statusCode===403);
  await call('/catalog-workspace/destinations/read',{item_ids:ids},401,branch,'');
  const permission=(await pool.query("SELECT id FROM permissions WHERE name='products.edit'")).rows[0];
  const prior=(await pool.query('SELECT * FROM user_permissions WHERE user_id=$1 AND permission_id=$2',[userId,permission.id])).rows[0];
  try{
   await pool.query('INSERT INTO user_permissions(user_id,permission_id,granted) VALUES($1,$2,false) ON CONFLICT(user_id,permission_id) DO UPDATE SET granted=false',[userId,permission.id]);
   const deniedToken=(await call('/auth/login',{username:'testadmin',password:'testpass123'})).token;
   const refused=await call('/catalog-workspace/destinations/review',{operations:[{key:'denied',operation:operation([ids[5]],'update',navy,{name:'Denied'})}]},200,branch,deniedToken);
   assert.match(refused.results[0].error,/permission/);
  }finally{
   if(prior)await pool.query('UPDATE user_permissions SET granted=$3 WHERE user_id=$1 AND permission_id=$2',[userId,permission.id,prior.granted]);
   else await pool.query('DELETE FROM user_permissions WHERE user_id=$1 AND permission_id=$2',[userId,permission.id]);
  }
  const other=(await pool.query('SELECT id FROM branches WHERE id<>$1 AND status=$2 LIMIT 1',[branch,'active'])).rows[0].id;
  assert((await call('/catalog-workspace/destinations/read',{item_ids:ids},200,other)).rows.every(row=>row.error));
  checks.push('Update permission and source branch isolation enforced');
  assert.deepEqual((await pool.query('SELECT id,stock_quantity,stock_distribution_source FROM inventory.items WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows,sourceBefore);
  assert.equal((await pool.query('SELECT count(*)::int n FROM stock_movements')).rows[0].n,stockBefore);
  checks.push('Every source quantity and stock movement count is unchanged');
  await fs.writeFile('verification/product-destinations-api.json',JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks}));
 }finally{host.close();await pool.end();}
}
verifyDestinations().catch(error=>{console.error(error);process.exitCode=1;});
