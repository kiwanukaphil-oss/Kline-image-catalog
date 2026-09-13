const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');

/** Exercise the actual extraction lifecycle and a concurrent staff edit against isolated local PostgreSQL. */
async function verifyExtractionPersistence(){
 const dependencies=require('./environment.cjs').configureTestEnvironment();
 require('./local-images.cjs').installLocalImageStore(dependencies);
 const {pool}=dependencies.source('config/database');
 process.env.CATALOG_AI_ENABLED='true';process.env.OPENAI_API_KEY='local-fixture';process.env.OPENAI_MAX_ATTEMPTS='1';delete process.env.OPENAI_MODEL;
 process.env.CATALOG_AI_RATE_PER_HOUR='10000';process.env.CATALOG_AI_RATE_PER_DAY='10000';
 const {extractCatalogItem}=dependencies.source('services/catalogAiExtractionService');
 const originalFetch=global.fetch,category=randomUUID(),itemId=randomUUID(),branchId='00000000-0000-4000-b111-000000000001';
 let calls=0;
 try{
  const userId=(await pool.query("SELECT id FROM users WHERE username='testadmin'")).rows[0].id;
  await pool.query("INSERT INTO inventory.categories(id,slug,name) VALUES($1,$2,'Shirts')",[category,'shirts-'+category]);
  for(const key of ['size','color','pattern','sleeve','fit','material'])await pool.query("INSERT INTO inventory.category_fields(category_id,key,label,type,required) VALUES($1,$2,$2,'text',false)",[category,key]);
  await pool.query("INSERT INTO inventory.items(id,category_id,branch_id,image_path,status,attributes,stock_quantity,stock_distribution_source,created_by) VALUES($1,$2,$3,$4,'draft','{}',7,'human_confirmed',$5)",[itemId,category,branchId,'shirts/'+itemId+'.jpg',userId]);
  global.fetch=async(url,options)=>{
   if(String(url)!=='https://api.openai.com/v1/responses')return originalFetch(url,options);
   calls++;const payload=JSON.parse(options.body);assert.equal(payload.model,'gpt-5.6-sol');
   // Simulate staff correction while the model is busy; the derived name must use the current values.
   await pool.query("UPDATE inventory.items SET brand='Staff Brand',attributes=attributes||$2::jsonb WHERE id=$1",[itemId,JSON.stringify({color:'Green',material:'Linen'})]);
   const values={brand:'OXFORD',name:'OXFORD shirt XXL',size:'XXL / 18-18½',color:'Blue',pattern:'Solid',sleeve:'Short',fit:'Slim',material:'Likely Cotton'};
   return new Response(JSON.stringify({id:'consistency-fixture',output_text:JSON.stringify({visible_text:'OXFORD XXL 18-18½',values,confidence:Object.fromEntries(Object.keys(values).map(key=>[key,'High'])),evidence:Object.fromEntries(Object.keys(values).map(key=>[key,{source:key==='material'?'visual_inference':'printed_label',observation:'Source label or material texture'}])),stock_distribution:{detected:true,evidence_text:'XXL',entries:[{variant_attributes:{size:'XXL'},quantity:1}],confidence:'High'}})}),{status:200});
  };
  await extractCatalogItem({itemId,branchId,userId});
  const item=(await pool.query('SELECT name,brand,attributes,stock_quantity,stock_distribution_source FROM inventory.items WHERE id=$1',[itemId])).rows[0];
  assert.equal(item.name,'Staff Brand Short Sleeve Shirt - Green');assert.equal(item.brand,'Staff Brand');assert.equal(item.attributes.material,'Linen');assert.equal(item.attributes.size,'2XL');assert.equal(item.stock_quantity,7);assert.equal(item.stock_distribution_source,'human_confirmed');assert.equal(calls,1);
  const usage=(await pool.query('SELECT model,status FROM inventory.ai_usage WHERE item_id=$1 ORDER BY created_at DESC LIMIT 1',[itemId])).rows[0];assert.equal(usage.model,'gpt-5.6-sol');assert.equal(usage.status,'succeeded');
  const report={passed:true,model:'gpt-5.6-sol',checks:['Concurrent staff brand, colour and material edits win','New name rebuilt consistently under the item lock','Dual alpha/neck size saved as 2XL','Human-confirmed quantity of seven unchanged','Size tag rejected as stock-lot evidence','Durable usage records the requested model']};
  fs.writeFileSync('verification/extraction-consistency-persistence.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{global.fetch=originalFetch;await pool.end();}
}
verifyExtractionPersistence().catch(error=>{console.error(error.message);process.exitCode=1;});
