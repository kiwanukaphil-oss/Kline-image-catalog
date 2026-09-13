import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const fixture=JSON.parse(await fs.readFile('../.test-data/bulk-preparation-fixture.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(20000);
const checks=[];
let token;
const button=name=>page.getByRole('button',{name,exact:true});
/** Read actual saved fixture state without touching a remote environment. */
async function readLot(id){
 const response=await fetch(`http://127.0.0.1:5109/api/catalog-workspace/items/${id}`,{headers:{Authorization:`Bearer ${token}`,'X-Branch-Id':fixture.branch}});
 assert.equal(response.status,200);return response.json();
}
/** Shared values are proposed once for all selected products, then saved as a batch. */
async function sharedValue(field,value){
 await page.getByLabel('Shared preparation field',{exact:true}).selectOption(field);
 const control=page.getByLabel('Shared preparation value',{exact:true});
 if(await control.evaluate(element=>element.tagName)==='SELECT')await control.selectOption(value);else await control.fill(value);
 await button('Apply value to selected').click();
}
try{
 await page.goto('http://localhost:5198');
 await page.getByLabel('Username',{exact:true}).fill('testadmin');
 await page.getByLabel('Password',{exact:true}).fill('testpass123');await button('Sign in').click();
 await page.getByRole('radio',{name:'Test Store',exact:true}).check();await button('Enter workspace').click();
 token=await page.evaluate(()=>sessionStorage.getItem('kline.session'));
 await page.getByRole('button').filter({hasText:fixture.title}).click();
 await button('Select all 52 source lots').click();await button('Prepare selected').click();
 const bulk=page.getByRole('dialog',{name:'Prepare selected products',exact:true});
 await bulk.getByText('Choose shared actions or edit the table, then save the batch.',{exact:true}).waitFor();
 await sharedValue('material','Cotton');await sharedValue('sleeve','Short');await button('Resolve selected problem flags').click();
 await button('Save selected details').click();await bulk.getByText('52 saved; 0 need attention. Successful products can continue.',{exact:true}).waitFor();
 checks.push('Shared required details and flags saved for 52 lots across pages');
 await button('Apply quantity to selected').click();
 await bulk.getByRole('button',{name:'Next',exact:true}).click();await bulk.getByRole('button',{name:'Next',exact:true}).click();
 await bulk.locator(`[data-preparation-id="${fixture.ids[0]}"]`).getByRole('button',{name:'Add size',exact:true}).click();
 await page.getByLabel(`Size ${fixture.ids[0]} 2`,{exact:true}).fill('L');await page.getByLabel(`Quantity ${fixture.ids[0]} 2`,{exact:true}).fill('2');
 await page.screenshot({path:'../verification/bulk-preparation-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'../verification/bulk-preparation-mobile.png'});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:1000});
 await button('Confirm selected counts').click();await button('Confirm batch quantities').click();
 await bulk.getByText('50 saved; 1 need attention. Successful products can continue.',{exact:true}).waitFor();
 assert.equal((await readLot(fixture.ids[1])).item.stock_quantity,5);assert.equal((await readLot(fixture.ids[0])).item.stock_quantity,3);
 assert.equal((await readLot(fixture.ids[2])).item.stock_distribution_source,'intake_default');
 checks.push('Count confirmation preserves confirmed quantities and isolates ambiguous labels');
 await page.getByLabel(`Size ${fixture.ids[2]} 1`,{exact:true}).fill('L');await page.getByLabel(`Quantity ${fixture.ids[2]} 1`,{exact:true}).fill('3');
 await button('Confirm selected counts').click();await button('Confirm batch quantities').click();
 await bulk.getByText('1 saved; 0 need attention. Successful products can continue.',{exact:true}).waitFor();
 checks.push('Only the corrected exception is retried');
 await button('Set selected prices and costs').click();await page.getByRole('heading',{name:'Pricing',exact:true}).waitFor();
 await page.getByLabel('Shared price',{exact:true}).fill('90000');await button('Review prices').click();await button('Save prices').click();
 await page.getByRole('heading',{name:'Prices saved',exact:true}).waitFor();await button('Price another group').click();
 await page.getByRole('tab',{name:'Costs',exact:true}).click();
 const selectAll=page.getByRole('button',{name:/^Select all .* matches$/});if(await selectAll.count())await selectAll.click();
 await page.getByLabel('Shared price',{exact:true}).fill('45000');await button('Review costs').click();await button('Save prices').click();
 await page.getByRole('heading',{name:'Prices saved',exact:true}).waitFor();await button('Return to Receiving').click();
 await page.getByRole('tab',{name:'Ready for POS',exact:true}).click();await button('Select all 52 source lots').click();await button('Receive selected into POS').click();
 await page.getByLabel('Shared destination action').selectOption('new');await button('Apply action to selected').click();
 await button('Review selected destinations').click();await button('Confirm reviewed destinations').click();
 await page.getByText('52 destinations saved; 0 need attention.',{exact:true}).waitFor();await button('Review receipt for saved stock').click();
 await button('Receive 52 lots into Test Store').click();await page.getByRole('heading',{name:'Stock received',exact:true}).waitFor({timeout:60000});
 const saved=[];
 for(let start=0;start<fixture.ids.length;start+=50){
  const response=await fetch('http://127.0.0.1:5109/api/catalog-workspace/preparation/read',{method:'POST',headers:{Authorization:`Bearer ${token}`,'X-Branch-Id':fixture.branch,'Content-Type':'application/json'},body:JSON.stringify({item_ids:fixture.ids.slice(start,start+50)})});
  assert.equal(response.status,200);const result=await response.json();saved.push(...result.results.map(row=>row.detail));
 }
 assert(saved.every(detail=>detail.item.is_published));
 assert.equal(saved.reduce((sum,detail)=>sum+detail.item.stock_quantity,0),60);
 checks.push('Bulk pricing, costs and receiving create exactly 60 units across 52 lots without product editors');
 await fs.writeFile('../verification/bulk-preparation-browser.json',JSON.stringify({passed:true,real_local_pos:true,checks},null,2));console.log(JSON.stringify({passed:true,checks}));
}catch(error){await page.screenshot({path:'../verification/bulk-preparation-error.png'});console.error((await page.locator('body').innerText()).slice(-5000));throw error;}
finally{await browser.close();}

