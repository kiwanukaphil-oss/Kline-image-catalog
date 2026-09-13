const fs=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const {configureTestEnvironment}=require('./environment.cjs');
const {installLocalImageStore}=require('./local-images.cjs');
/** Create one isolated, multi-page delivery for the real bulk-preparation browser journey. */
async function seedBulkPreparation(){
 const dependencies=configureTestEnvironment();installLocalImageStore(dependencies);
 const {pool}=dependencies.source('config/database');
 try{
  const user=(await pool.query("SELECT id FROM users WHERE username='testadmin'")).rows[0];
  const branch='00000000-0000-4000-b111-000000000001';
  const category=randomUUID(),batch=randomUUID();
  await pool.query("INSERT INTO inventory.categories(id,slug,name) VALUES($1,$2,'Bulk preparation test shirts')",[category,`bulk-${category}`]);
  await pool.query("INSERT INTO inventory.category_fields(category_id,key,label,type,options,required) VALUES($1,'size','Size','size',NULL,true),($1,'material','Material','text',NULL,true),($1,'sleeve','Sleeve','select',ARRAY['Short','Long'],true)",[category]);
  const target=(await pool.query('SELECT pos_category_id FROM inventory.pos_category_map LIMIT 1')).rows[0].pos_category_id;
  await pool.query('INSERT INTO inventory.pos_category_map(id,image_category_id,pos_category_id,created_at,updated_at) VALUES($1,$2,$3,now(),now())',[randomUUID(),category,target]);
  const title=`Bulk preparation ${Date.now()}`;
  await pool.query('INSERT INTO catalog_workspace.batches(id,branch_id,created_by,title) VALUES($1,$2,$3,$4)',[batch,branch,user.id,title]);
  const bytes=await fs.readFile('design/assets/item-0.jpg');
  const intake=dependencies.source('services/catalogIntakeService');
  const ids=[];
  for(let index=0;index<Number(process.env.BULK_FIXTURE_COUNT || 52);index++){
   const id=randomUUID();ids.push(id);
   await intake.createCatalogItemFromImage({itemId:id,categoryId:category,branchId:branch,userId:user.id,brand:'Bulk fixture',attributes:{},status:'draft',image:{buffer:bytes,mimetype:'image/jpeg',originalname:'fixture.jpg'}});
   await pool.query('UPDATE inventory.items SET name=$2,attributes=$3,status=$4 WHERE id=$1',[id,`Bulk shirt ${String(index+1).padStart(2,'0')}`,{size:index===2?'M / L':'M'},index===3?'flag':'draft']);
   await pool.query('INSERT INTO catalog_workspace.batch_items(item_id,batch_id,added_by) VALUES($1,$2,$3)',[id,batch,user.id]);
  }
  const service=require('../workspace-service.cjs').createWorkspaceService(dependencies);
  const confirmed=await service.itemDetail(branch,ids[1],user.id);
  await service.confirmCount({itemId:ids[1],branchId:branch,userId:user.id,payload:{expected_revision:confirmed.revision,entries:[{variant_attributes:{size:'M'},quantity:5}]}});
  await fs.writeFile(process.env.BULK_FIXTURE_OUTPUT || '.test-data/bulk-preparation-fixture.json',JSON.stringify({title,batch,branch,category,target,ids,userId:user.id},null,2));
  console.log(JSON.stringify({title,lots:ids.length}));
 }finally{await pool.end();}
}
seedBulkPreparation().catch(error=>{console.error(error);process.exitCode=1;});


