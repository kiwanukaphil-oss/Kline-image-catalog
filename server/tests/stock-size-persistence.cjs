const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
/** Exercise the real AI lifecycle with deterministic visual responses, verifying size/count independence and priced-row preservation. */
async function verifyStockSizePersistence(){
 const deps=require('./environment.cjs').configureTestEnvironment();require('./local-images.cjs').installLocalImageStore(deps);
 const {pool}=deps.source('config/database');process.env.CATALOG_AI_ENABLED='true';process.env.OPENAI_API_KEY='local-fixture';process.env.OPENAI_MAX_ATTEMPTS='1';process.env.CATALOG_AI_RATE_PER_HOUR='10000';process.env.CATALOG_AI_RATE_PER_DAY='10000';
 const {extractCatalogItem}=deps.source('services/catalogAiExtractionService');const originalFetch=global.fetch;
 const branchId='00000000-0000-4000-b111-000000000001',category=randomUUID();let active;const checks=[];
 try{
  const userId=(await pool.query("SELECT id FROM users WHERE username='testadmin'")).rows[0].id;
  await pool.query("INSERT INTO inventory.categories(id,slug,name) VALUES($1,$2,'Jeans')",[category,'size-jeans-'+category]);
  for(const key of ['size','material','color'])await pool.query("INSERT INTO inventory.category_fields(category_id,key,label,type,required) VALUES($1,$2,$2,'text',false)",[category,key]);
  global.fetch=async(url,options)=>{
   if(String(url)!=='https://api.openai.com/v1/responses')return originalFetch(url,options);
   if(active.concurrent)await pool.query("UPDATE inventory.items SET attributes=attributes||'{\"size\":\"42\"}'::jsonb WHERE id=$1",[active.itemId]);
   const values={brand:'GAP',name:'GAP Jeans - Blue',size:active.size,material:'Cotton',color:'Blue'};
   const text=active.explicit?'40\nQty: 2 pieces':active.size;
   return new Response(JSON.stringify({id:'size-persistence-fixture',output_text:JSON.stringify({values,visible_text:text,confidence:Object.fromEntries(Object.keys(values).map(k=>[k,'High'])),evidence:Object.fromEntries(Object.keys(values).map(k=>[k,{source:'caption',observation:text}])),stock_distribution:active.explicit?{detected:true,evidence_text:'Qty: 2 pieces',confidence:'High',entries:[{variant_attributes:{},quantity:2}]}:{detected:false,evidence_text:null,confidence:null,entries:[]}})}),{status:200});
  };
  for(const spec of [{source:'intake_default',quantity:1,size:'40'},{source:'ai_suggested',quantity:2,size:'40'},{source:'intake_default',quantity:1,size:'40',explicit:true},{source:'human_confirmed',quantity:7,size:'40'},{source:'intake_default',quantity:1,size:'38-40'},{source:'intake_default',quantity:1,size:'40',concurrent:true},{source:'intake_default',quantity:1,size:'40',concurrent:true,explicit:true}]){
   const itemId=randomUUID(),lineId=randomUUID();active={...spec,itemId};
   await pool.query(`INSERT INTO inventory.items(id,category_id,branch_id,image_path,status,attributes,stock_quantity,stock_distribution,stock_distribution_source,price,created_by) VALUES($1,$2,$3,$4,'draft','{}',$5,$6::jsonb,$7,90000,$8)`,[itemId,category,branchId,'jeans/'+itemId+'.jpg',spec.quantity,JSON.stringify([{variant_attributes:{},quantity:spec.quantity}]),spec.source,userId]);
   await pool.query('INSERT INTO inventory.item_variant_lines(id,item_id,position,variant_key,variant_attributes,quantity,price_override,cost_override,updated_by) VALUES($1,$2,0,MD5($3::jsonb::text),$3::jsonb,$4,110000,50000,$5)',[lineId,itemId,'{}',spec.quantity,userId]);
   await extractCatalogItem({itemId,branchId,userId});
   const item=(await pool.query('SELECT * FROM inventory.items WHERE id=$1',[itemId])).rows[0],lines=(await pool.query('SELECT * FROM inventory.item_variant_lines WHERE item_id=$1',[itemId])).rows;
   assert.equal(lines.length,1);assert.equal(lines[0].id,lineId);assert.equal(Number(lines[0].price_override),110000);assert.equal(Number(lines[0].cost_override),50000);assert.equal(Number(item.price),90000);
   const quantity=spec.explicit?2:spec.quantity;assert.equal(Number(item.stock_quantity),quantity);assert.equal(Number(lines[0].quantity),quantity);
   const expected=spec.source==='human_confirmed'||spec.size==='38-40'?undefined:spec.concurrent?'42':'40';
   assert.equal(lines[0].variant_attributes.size,expected,JSON.stringify(spec));assert.equal(item.stock_distribution[0].variant_attributes.size,expected);
   assert.equal(item.stock_distribution_source,spec.explicit?'ai_suggested':spec.source);
   checks.push({...spec,passed:true});
  }
  fs.writeFileSync('verification/ai-stock-size-persistence.json',JSON.stringify({passed:true,checks,prices_costs_row_ids_preserved:true,provider_calls:'local fixtures; no paid model calls'},null,2));console.log(JSON.stringify({passed:true,checks}));
 }finally{global.fetch=originalFetch;await pool.end();}
}
verifyStockSizePersistence().catch(error=>{console.error(error);process.exitCode=1;});
