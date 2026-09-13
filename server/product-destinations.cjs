const {createHash, createHmac}=require('node:crypto');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Batch destinations reuse stock grouping and archive photo-only intake without creating stock publications. */
function createProductDestinationService(dependencies){
 const {source}=dependencies, {pool}=source('config/database');
 const repository=source('repositories/CatalogPublicationRepository');
 const DomainError=source('errors/DomainError');
 const Cancellation=source('models/CatalogCancellation');
 const {createPublicationRevision}=source('services/catalogPublicationService');
 const {createCatalogImageUrl}=source('services/catalogImageStorageService');
 const {createProductImageUrl}=source('utils/productImageStorage');
 const sign=value=>createHmac('sha256',process.env.JWT_SECRET).update(JSON.stringify(value)).digest('hex');
 const fail=message=>{throw DomainError.validationFailed(message);};
 const idsOf=ids=>{if(!Array.isArray(ids)||!ids.length||ids.length>1000||new Set(ids).size!==ids.length||ids.some(id=>!UUID.test(id)))fail('Choose distinct source lots.');return [...ids].sort();};
 const groupRevision=(group,branchId,userId)=>createPublicationRevision(group,{branchId,userId});

 /** Search existing identities with photos and size evidence; names are suggestions, never an automatic assignment. */
 async function products({categoryId,search='',branchId}){
  if(!UUID.test(categoryId)||typeof search!=='string'||search.length>120)fail('Choose a category and a shorter search.');
  const result=await pool.query(`SELECT p.id,p.name,p.description,p.category_id,p.master_sku,p.image_path,p.xmin::text version,b.name brand,
   EXISTS(SELECT 1 FROM inventory.catalog_publications cp JOIN inventory.items i ON i.id=cp.item_id WHERE cp.product_id=p.id AND i.branch_id=$3) AS previously_received,
   (SELECT jsonb_agg(v.variant_attributes ORDER BY v.id) FROM product_variants v WHERE v.product_id=p.id AND v.is_active=true) variants
   FROM products p LEFT JOIN brands b ON b.id=p.brand_id WHERE p.category_id=$1 AND p.is_active=true AND p.status='published'
   AND (strpos(lower(p.name),lower($2))>0 OR strpos(lower(coalesce(p.master_sku,'')),lower($2))>0 OR strpos(lower(coalesce(b.name,'')),lower($2))>0)
   ORDER BY previously_received DESC,p.name,p.id LIMIT 60`,[categoryId,search.trim(),branchId]);
  return Promise.all(result.rows.map(async({image_path,...product})=>({...product,image_url:image_path?await createProductImageUrl(image_path):null})));
 }

 /** Read independent lots in bounded requests; include full group membership so partial decisions cannot split a group silently. */
 async function read({itemIds,branchId,userId}){
  const ids=idsOf(itemIds);if(ids.length>50)fail('Read at most 50 lots per request.');
  return repository.withTransaction(async client=>{
   const groups=(await client.query('SELECT * FROM catalog_workspace.product_matches WHERE branch_id=$1 AND retired_at IS NULL AND result_product_id IS NULL AND item_ids && $2::uuid[] ORDER BY id',[branchId,ids])).rows;
   const rows=[];
   for(const id of ids){
    const context=await repository.loadLockedContext(client,{itemId:id,branchId});
    if(!context){rows.push({id,error:'Source lot unavailable in this branch.'});continue;}
    const item=context.item;
    if(item.publication_id||item.pos_product_id||item.intake_cancelled_at){rows.push({id,error:'Already received, POS-linked or archived. Use POS to reconcile received stock.'});continue;}
    const group=groups.find(group=>group.item_ids.includes(id));
    rows.push({id,name:item.name,brand:item.brand,attributes:item.attributes,category_id:item.pos_category_id,
     image_url:item.image_path?await createCatalogImageUrl(item.image_path):null,
     revision:createPublicationRevision(context,{branchId,userId}),
     group:group?{id:group.id,item_ids:group.item_ids,target_product_id:group.target_product_id,product_name:group.product_name,revision:groupRevision(group,branchId,userId)}:null});
   }
   return {rows};
  });
 }

 /** Validate explicit choices and sign source, group and target state before any save or no-stock update. */
 async function inspect(client,{operation,branchId,userId,canUpdate}){
  const ids=idsOf(operation.item_ids),mode=operation.mode;
  if(!['new','restock','update'].includes(mode))fail('Choose new product, restock or photo/details update.');
  if(mode==='update'&&!canUpdate)throw new DomainError('Updating POS details requires product-edit, catalog-edit and intake-archive permission.',403);
  const contexts=[];
  for(const itemId of ids){
   const context=await repository.loadLockedContext(client,{itemId,branchId});
   if(!context)throw DomainError.notFound('A source lot is unavailable in this branch.');
   if(context.item.publication_id||context.item.pos_product_id||context.item.intake_cancelled_at)throw DomainError.conflict('A source lot was received or archived. Reload destinations.');
   if(await Cancellation.runningAi(client,itemId))throw DomainError.conflict('AI is working on this lot. Reload when it finishes.');
   contexts.push(context);
  }
  if(new Set(contexts.map(context=>context.item.category_id)).size!==1)fail('Each destination must contain one catalog category.');
  const groups=(await client.query('SELECT * FROM catalog_workspace.product_matches WHERE branch_id=$1 AND retired_at IS NULL AND result_product_id IS NULL AND item_ids && $2::uuid[] ORDER BY id FOR UPDATE',[branchId,ids])).rows;
  if(groups.some(group=>group.item_ids.some(id=>!ids.includes(id))))fail('Include every member of the existing group in the same destination.');
  const defaults=groups.map(group=>group.variant_defaults||{});
  if(mode!=='update'&&new Set(defaults.map(value=>JSON.stringify(Object.entries(value).sort()))).size>1)fail('Existing groups use different shared colour or fit values. Keep these groups separate when assigning their destinations.');
  let target=null;
  if(mode!=='new'){
   if(!UUID.test(operation.target_product_id))fail('Choose the existing POS product.');
   target=(await client.query('SELECT id,name,description,brand_id,category_id,status,is_active,image_path,xmin::text version FROM products WHERE id=$1 FOR UPDATE',[operation.target_product_id])).rows[0];
   if(!target?.is_active||target.status!=='published'||target.category_id!==contexts[0].item.pos_category_id)fail('Choose an active POS product in the mapped category.');
  }
  const cleanText=(value,max)=>{if(typeof value!=='string'||value.trim().length>max)fail('Invalid destination text.');return value.trim();};
  const name=cleanText(operation.name||contexts[0].item.name||'',200),brand=cleanText(operation.brand||contexts[0].item.brand||'',120);
  if(mode!=='update'&&(!name||!brand))fail('Set the product name and brand before saving the destination.');
  const note=cleanText(operation.note||'',1000);if(!note)fail('Record why these lots belong to this product.');
  const patch=operation.patch||{};
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['name','description','add_photos'].includes(key)))fail('Only explicit name, description and photo updates are supported here.');
  if(patch.name!==undefined&&(!cleanText(patch.name,200)))fail('A product name cannot be blank.');
  if(patch.description!==undefined)cleanText(patch.description,4000);
  if(patch.add_photos!==undefined&&typeof patch.add_photos!=='boolean')fail('Confirm whether to add photos.');
  if(mode==='update'&&patch.name===undefined&&patch.description===undefined&&patch.add_photos!==true)fail('Choose at least one field or photo update.');
  if(mode==='update'&&patch.add_photos&&contexts.some(context=>!context.item.image_path))fail('A source photo is missing.');
  const normalized={item_ids:ids,mode,target_product_id:target?.id||null,name,brand,note,variant_defaults:defaults[0]||{},patch:mode==='update'?patch:{}};
  const revision=sign({operation:normalized,branchId,userId,contexts,groups,target});
  return {contexts,groups,target,normalized,revision};
 }

 /** A review has no side effects; compare the displayed source snapshots so intervening edits need a fresh screen. */
 async function review(input){
  return repository.withTransaction(async client=>{
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended('catalog-matching:' || $1,0))",[input.branchId]);
   const checked=await inspect(client,input);
   for(const context of checked.contexts){if(input.operation.source_revisions?.[context.item.id]!==createPublicationRevision(context,{branchId:input.branchId,userId:input.userId}))throw DomainError.conflict('A source lot changed. Reload destinations.');}
   for(const group of checked.groups){if(input.operation.group_revisions?.[group.id]!==groupRevision(group,input.branchId,input.userId))throw DomainError.conflict('A grouping changed. Reload destinations.');}
   if(checked.target&&String(input.operation.target_version)!==checked.target.version)throw DomainError.conflict('The POS product changed. Refresh product choices.');
   return {revision:checked.revision,operation:checked.normalized,target_name:checked.target?.name||null,source_lots:checked.contexts.length,
    changes:checked.normalized.mode==='update'?{before:{name:checked.target.name,description:checked.target.description},after:checked.normalized.patch}:null,
    effect:checked.normalized.mode==='update'?'Update global POS details/photos and archive source intake; no stock movement.':'Save destination only. Confirm counts and review receipt separately.'};
  });
 }

 /** Copy immutable photo bytes before attaching; the original and existing gallery files are retained. */
 async function copyPhoto(item){
  const storage=source('services/railwayObjectStorageService');
  const original=await storage.downloadPrivateObject(item.image_path);
  const meta=await storage.inspectPrivateObject(item.image_path);
  if(!original.buffer?.length||original.buffer.length>15*1024*1024||!['image/jpeg','image/png','image/webp'].includes(meta.contentType))fail('Unsupported source photo.');
  const digest=createHash('sha256').update(original.buffer).digest('hex'),key=`pos-products/catalog-update/${item.id}/${digest}`;
  await storage.storePrivateObjectIfAbsent({objectKey:key,buffer:original.buffer,contentType:meta.contentType,metadata:{'catalog-item-id':item.id,sha256:digest}});
  const copied=await storage.inspectPrivateObject(key);
  if(copied.contentLength!==original.buffer.length||copied.metadata.sha256!==digest)fail('Photo verification failed; no update applied.');
  return key;
 }

 /** Each reviewed destination commits independently, with atomic group replacement and no stock writes. */
 async function apply(input){
  return repository.withTransaction(async client=>{
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended('catalog-matching:' || $1,0))",[input.branchId]);
   // Use the intake lock before source rows, matching cancellation's lock order.
   for(const id of idsOf(input.operation.item_ids))await Cancellation.lockIntake(client,id);
   const checked=await inspect(client,input),{contexts,groups,target,normalized}=checked;
   if(input.expectedRevision!==checked.revision)throw DomainError.conflict('This destination changed or was already saved. Reload saved state before retrying.');
   const matching=require('./product-matching.cjs').createProductMatchingService({source:name=>name==='repositories/CatalogPublicationRepository'?Object.assign(Object.create(repository),{withTransaction:work=>work(client)}):source(name)});
   for(const group of groups)await matching.retire({branchId:input.branchId,userId:input.userId,id:group.id,expectedRevision:groupRevision(group,input.branchId,input.userId)});
   let result;
   if(normalized.mode==='update'){
    const patch=normalized.patch;
    if(patch.name!==undefined||patch.description!==undefined)await client.query('UPDATE products SET name=CASE WHEN $2 THEN $3 ELSE name END,description=CASE WHEN $4 THEN $5 ELSE description END,updated_at=now() WHERE id=$1',[target.id,patch.name!==undefined,patch.name,patch.description!==undefined,patch.description]);
    if(patch.add_photos)for(const context of contexts){
     const key=await copyPhoto(context.item);
     const existing=(await client.query('SELECT id FROM product_images WHERE product_id=$1 AND image_path=$2',[target.id,key])).rowCount;
     if(!existing){
      const primary=!target.image_path&&!(await client.query('SELECT id FROM product_images WHERE product_id=$1 LIMIT 1',[target.id])).rowCount;
      await client.query("INSERT INTO product_images(product_id,image_path,alt_text,sort_order,is_primary) VALUES($1,$2,'Catalog update',0,$3)",[target.id,key,primary]);
      if(primary){await client.query('UPDATE products SET image_path=$2,updated_at=now() WHERE id=$1',[target.id,key]);target.image_path=key;}
     }
    }
    for(const context of contexts)await Cancellation.save(client,{itemId:context.item.id,branchId:input.branchId,userId:input.userId,reason:`Completed POS photo/details update to ${target.id}; no incoming stock.`,restore:false,hasItem:true});
    result={saved:true,mode:'update',product_id:target.id,archived_ids:normalized.item_ids};
   }else{
    const group=await matching.save({branchId:input.branchId,userId:input.userId,allowSingleNew:true,plan:{item_ids:normalized.item_ids,target_product_id:normalized.target_product_id,product_name:normalized.name,brand_name:normalized.brand,variant_defaults:normalized.variant_defaults,review_note:normalized.note}});
    result={saved:true,mode:normalized.mode,group_id:group.id,item_ids:group.item_ids};
   }
   await client.query("INSERT INTO user_audit_logs(user_id,action,module,description) VALUES($1,'catalog.destination.apply','catalog',$2)",[input.userId,JSON.stringify({operation:normalized,result})]);
   return result;
  });
 }
 return {read,products,review,apply};
}
module.exports={createProductDestinationService};
