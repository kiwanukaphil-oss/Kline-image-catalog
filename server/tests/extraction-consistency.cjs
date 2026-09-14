const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../host-integration/catalogExtractionPolicy.cjs');
const backend = path.resolve(process.env.CATALOG_EXTRACTION_TEST_BACKEND || '.test-data/caption-consistency-20260913/pos/backend');
const { extractionPolicy: service } = require(path.join(backend,'src/services/catalogAiExtractionService.js'));
const stock = require(path.join(backend,'src/utils/catalogStockDistribution.js'));
const checks=[];
const check=(label,action)=>{action();checks.push(label);};
const fields=['size','color','pattern','sleeve','fit','material'].map(key=>({key,label:key,type:'text',required:false}));
const run={item:{category_path:'Clothing > Shirts > Business Casual',category_slugs:['shirts'],attributes:{}},fields,vocabularies:[{field:'brand',canonical:'Oxford',aliases:[]}]};
const result=(values,source='visual_observation')=>({visible_text:'OXFORD XXL',values,confidence:Object.fromEntries(Object.keys(values).map(key=>[key,'High'])),evidence:Object.fromEntries(Object.keys(values).map(key=>[key,{source,observation:'Photographed product evidence'}])),stock_distribution:{detected:false,evidence_text:null,entries:[],confidence:null}});

check('Equivalent alpha sizes agree in extraction and manual stock distributions; ambiguous and regional sizes remain distinct',()=>{
 for(const [input,expected]of [['W40','40'],['W 40','40'],['w 40','40'],['W32.5','32.5'],['XXL','2XL'],['2 xl','2XL'],['XXXL','3XL'],['XXXXXL','5XL'],['Extra-Large','XL'],['Medium','M'],['2XXL','2XXL'],['EU 42','EU 42'],['UK 8.5','UK 8.5'],['16-16½','16-16½'],['W32 L34','W32 L34']]){
  assert.equal(policy.canonicalCatalogSize(input),expected);assert.equal(stock.canonicalCatalogSize(input),expected);
  assert.equal(service.normalizeStructuredExtraction(result({size:input}),run).values.size,expected);
 }
});
check('Stable garment names exclude size, price and material; existing brand spelling wins without fuzzy correction',()=>{
 const extraction=service.normalizeStructuredExtraction(result({name:'OXFORD shirt XXL cotton',brand:'OXFORD',size:'XXL',color:'navy blue',pattern:'floral/paisley',sleeve:'short-sleeved',fit:'Slim fit',material:'Likely Cotton'}),run);
 assert.equal(extraction.values.name,'Oxford Short Sleeve Shirt - Navy Floral Paisley');assert.equal(extraction.values.material,'Cotton');assert.equal(extraction.confidence.material,'Medium');assert.equal(extraction.evidence.material.source,'visual_inference');
 const fake=service.normalizeStructuredExtraction(result({brand:'OXF0RD',color:'White',pattern:'Plain',sleeve:'Long'}),run);assert.equal(fake.values.name,'OXF0RD Long Sleeve Shirt - White');
});
check('Saved attributes constrain a new name; material alternatives and invented percentages cannot pass as facts',()=>{
 const saved={...run,item:{...run.item,brand:'OXFORD',attributes:{color:'White',sleeve:'Short'}}};
 const extracted=service.normalizeStructuredExtraction(result({brand:'Other',name:'Other Shirt Blue',color:'Blue',sleeve:'Long',material:'Likely cotton or cotton blend'}),saved);
 assert.equal(extracted.values.name,'Oxford Short Sleeve Shirt - White');assert.equal(extracted.values.material,undefined);
 assert.equal(service.normalizeStructuredExtraction(result({material:'100% Cotton'}),run).values.material,undefined);
 assert.equal(service.normalizeStructuredExtraction(result({material:'100% Cotton'},'printed_label'),run).values.material,'100% Cotton');
 assert.equal(policy.normalizeCatalogField('material','Linen'), 'Linen');
});
check('Numbers retain numeric types; provider objects, booleans and placeholders are rejected',()=>{
 const numeric={...run,fields:[...fields,{key:'volume',type:'number',label:'Volume'}]};
 const extracted=service.normalizeStructuredExtraction(result({volume:'100',material:'null',size:{text:'L'},color:true}),numeric);
 assert.equal(extracted.values.volume,100);assert.equal(extracted.values.size,undefined);assert.equal(extracted.values.color,undefined);assert.equal(extracted.values.material,undefined);
});
check('Shirt alpha sizes are primary while collar sizes remain evidence; genuine dual sizes are preserved',()=>{
 for(const input of ['XXL / 18-18½','2XL 18-18½']) {
  const extracted=service.normalizeStructuredExtraction(result({size:input},'printed_label'),run);
  assert.equal(extracted.values.size,'2XL');assert(extracted.evidence.size.observation.includes('18-18½'));
 }
 assert.equal(service.normalizeStructuredExtraction(result({size:'M/L'}),run).values.size,'M/L');
 const {variantIdentity}=require('../product-matching.cjs');
 assert.deepEqual(variantIdentity({size:'XXXXXL'}),variantIdentity({size:'5XL'}));
 assert.notDeepEqual(variantIdentity({size:'2XXL'}),variantIdentity({size:'XXL'}));
});
check('Stock extraction requires quoted lot evidence; duplicate size aliases cannot double stock',()=>{
 const distribution=(text,entries)=>({...result({size:'XXL'}),visible_text:text,stock_distribution:{detected:true,evidence_text:text,entries,confidence:'High'}});
 const entry=size=>({variant_attributes:{size},quantity:1});
 assert.equal(service.normalizeStructuredExtraction(distribution('XXL',[entry('XXL')]),run).stockDistribution,null);
 assert.equal(service.normalizeStructuredExtraction(distribution('Qty: XXL 1 piece',[entry('XXL'),entry('2XL')]),run).stockDistribution,null);
 assert.equal(service.normalizeStructuredExtraction(distribution('Qty: W40 1 piece',[entry('W40'),entry('40')]),run).stockDistribution,null);
 assert.equal(service.normalizeStructuredExtraction(distribution('Sizes: S-L and M',[entry('S-L'),entry('M')]),run).stockDistribution,null);
 assert.equal(service.normalizeStructuredExtraction(distribution('Sizes: small-3xl',[entry('S-3XL')]),run).stockDistribution.totalQuantity,6);
});
check('Initial/retry prompts agree and Sol uses the supported structured image request',()=>{
 const prompt=service.buildExtractionPrompt(run.item.category_path,fields,run.item);
 const retry=service.buildTargetedRetryPrompt(run.item.category_path,fields,{missingRequiredFields:[],missingVisualInferenceFields:['material'],missingStockDistribution:false},run.item);
 assert(prompt.includes('choose ONE'));assert(retry.includes(policy.POLICY_VERSION));assert(!prompt.includes('use cautious wording'));
 const payload=service.buildProviderPayload({model:policy.DEFAULT_MODEL,imageUrl:'data:image/jpeg;base64,example',extractionSchema:service.buildExtractionSchema(fields),prompt});
 assert.equal(payload.model,'gpt-5.6-sol');assert.equal(payload.input[0].content[1].detail,'original');assert.equal(payload.text.format.strict,true);assert.equal(payload.store,false);
});
fs.writeFileSync('verification/extraction-consistency-tests.json',JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
