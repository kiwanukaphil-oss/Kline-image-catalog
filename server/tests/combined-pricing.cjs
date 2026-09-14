const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {configureTestEnvironment}=require('./environment.cjs');
/** Exercise merged plans against the POS engine: atomic retail/cost saves, optional costs, conflicts and undo. */
async function verifyCombinedPricing(){
 const deps=configureTestEnvironment(),{pool}=deps.source('config/database');require('./local-images.cjs').installLocalImageStore(deps);
 const service=deps.source('services/catalogPricingPlanService');
 const {compileCombinedPriceProposal}=await import(pathToFileURL(path.resolve('app/lib/pricing.ts')));
 const actor={branchId:'00000000-0000-4000-b111-000000000001',userId:(await pool.query("SELECT id FROM users WHERE username='testadmin'")).rows[0].id,canViewCost:true};
 const category=(await pool.query('SELECT image_category_id FROM inventory.pos_category_map LIMIT 1')).rows[0].image_category_id;
 const id=randomUUID(),lineIds=[randomUUID(),randomUUID()];
 try {
  await pool.query(`INSERT INTO inventory.items(id,category_id,branch_id,name,status,image_path,stock_quantity,stock_distribution_source,created_by,updated_by) VALUES($1,$2,$3,'Combined pricing test','needs-review','test.jpg',2,'ai_suggested',$4,$4)`,[id,category,actor.branchId,actor.userId]);
  for(let n=0;n<2;n++) await pool.query('INSERT INTO inventory.item_variant_lines(id,item_id,position,variant_key,variant_attributes,quantity,updated_by) VALUES($1,$2,$3,$4,$5,1,$6)',[lineIds[n],id,n,String(n),JSON.stringify({size:n?'XL':'M'}),actor.userId]);
  const read=()=>service.loadPricingWorkspace({...actor,payload:{item_ids:[id]}});
  let workspace=await read();
  const retailOnly=compileCombinedPriceProposal(workspace.items,lineIds,'90000',{},'',{},'fill');
  const pendingCost=await service.previewPricingPlan({...actor,payload:retailOnly});
  await service.operatePricingPlan({...actor,id:pendingCost.id,operation:'apply'});
  assert((await read()).items[0].lines.every(line=>line.effective_cost===null));
  const matching=require('../product-matching.cjs').createProductMatchingService(deps);
  const checkout=require('../delivery-checkout.cjs').createDeliveryCheckout(deps,matching);
  const blocked=(await checkout.review([id],actor)).results[0];
  assert.match(blocked.error,/cost price/i);assert(!blocked.revision);
  await service.operatePricingPlan({...actor,id:pendingCost.id,operation:'undo'});
  workspace=await read();
  const payload=compileCombinedPriceProposal(workspace.items,lineIds,'90000',{[lineIds[1]]:'110000'},'40000',{[lineIds[1]]:'50000'},'fill');
  assert.equal(payload.items.length,1);assert.equal(payload.items[0].lines.length,1);assert.equal(payload.items[0].lines[0].cost_override,50000);
  const plan=await service.previewPricingPlan({...actor,payload});assert.equal((await read()).items[0].lines[0].effective_price,null);
  await service.operatePricingPlan({...actor,id:plan.id,operation:'apply'});await service.operatePricingPlan({...actor,id:plan.id,operation:'apply'});
  workspace=await read();assert.deepEqual(lineIds.map(id=>workspace.items[0].lines.find(line=>line.id===id).effective_price),[90000,110000]);assert.deepEqual(lineIds.map(id=>workspace.items[0].lines.find(line=>line.id===id).effective_cost),[40000,50000]);
  const blank=compileCombinedPriceProposal(workspace.items,lineIds,'95000',{},'',{},'revise');assert.equal(blank.cost_mode,'leave');assert(!JSON.stringify(blank.items).includes('cost'));
  const retailPlan=await service.previewPricingPlan({...actor,payload:blank});await service.operatePricingPlan({...actor,id:retailPlan.id,operation:'apply'});
  workspace=await read();assert.deepEqual(lineIds.map(id=>workspace.items[0].lines.find(line=>line.id===id).effective_cost),[40000,50000]);
  await service.operatePricingPlan({...actor,id:retailPlan.id,operation:'undo'});
  const costOnly=compileCombinedPriceProposal((await read()).items,[lineIds[0]],'',{},'45000',{},'revise');assert.equal(costOnly.retail_mode,'leave');assert(!Object.hasOwn(costOnly.items[0],'base_cost_price'));
  await assert.rejects(service.previewPricingPlan({...actor,canViewCost:false,payload:costOnly}),/Cost permission/);
  const costPlan=await service.previewPricingPlan({...actor,payload:costOnly});await service.operatePricingPlan({...actor,id:costPlan.id,operation:'apply'});
  workspace=await read();assert.deepEqual(lineIds.map(id=>workspace.items[0].lines.find(line=>line.id===id).effective_price),[90000,110000]);assert.deepEqual(lineIds.map(id=>workspace.items[0].lines.find(line=>line.id===id).effective_cost),[45000,50000]);
  assert.throws(()=>compileCombinedPriceProposal(workspace.items,lineIds,'90000',{},'-1',{},'fill'),/positive price/);
  const checks=['Retail can save with blank costs; POS review remains blocked until costs exist','One atomic retail and cost plan with size exceptions','Preview does not save; apply retry is safe','Blank cost omits all cost edits and preserves saved values','Undo preserves both fields','Cost-only selected-size update preserves retail and sibling costs','Cost permissions and invalid amounts enforced'];
  await fs.writeFile('verification/combined-pricing-api.json',JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks}));
 }finally{await pool.end();}
}
verifyCombinedPricing().catch(error=>{console.error(error);process.exitCode=1;});
