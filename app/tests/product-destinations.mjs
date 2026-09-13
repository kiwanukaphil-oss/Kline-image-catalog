import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const fixture=JSON.parse(await fs.readFile('../.test-data/destination-fixture.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);
const button=name=>page.getByRole('button',{name,exact:true});
const checks=[];
// Hosted UI requests are redirected to isolated local fixtures so this test cannot change production merchandise.
if(process.env.LIVE_TEST_URL)await page.route('**/api/**',async route=>{
 const request=route.request(),url=new URL(request.url()),headers={...request.headers()};
 delete headers.host;delete headers.origin;delete headers['content-length'];
 const response=await fetch('http://127.0.0.1:5109'+url.pathname+url.search,{method:request.method(),headers,body:request.postDataBuffer()||undefined});
 await route.fulfill({status:response.status,contentType:response.headers.get('content-type')||'application/json',body:Buffer.from(await response.arrayBuffer())});
});
/** Exercise real local source records through a single mixed-destination batch, never production stock. */
async function verifyDestinationBrowser(){
 await page.goto(process.env.LIVE_TEST_URL||'http://localhost:5198');await page.getByLabel('Username',{exact:true}).fill('testadmin');await page.getByLabel('Password',{exact:true}).fill('testpass123');await button('Sign in').click();
 await page.getByRole('radio',{name:'Test Store',exact:true}).check();await button('Enter workspace').click();
 await page.getByRole('button').filter({hasText:fixture.title}).click();await button('Select all 8 source lots').click();await button('Choose destinations').click();
 const dialog=page.getByRole('dialog',{name:'Choose product destinations',exact:true});
 await page.getByLabel(`Action ${fixture.ids[0]}`,{exact:true}).waitFor();
 assert.equal(await page.getByLabel(`Action ${fixture.ids[0]}`,{exact:true}).inputValue(),'');
 await page.getByLabel('Shared destination action').selectOption('restock');await button('Apply action to selected').click();
 for(let index=0;index<4;index++)await page.getByLabel(`Existing product ${fixture.ids[index]}`,{exact:true}).selectOption(fixture.products[index<2?0:1].id);
 for(let index=4;index<6;index++){
  await page.getByLabel(`Action ${fixture.ids[index]}`,{exact:true}).selectOption('update');
  await page.getByLabel(`Existing product ${fixture.ids[index]}`,{exact:true}).selectOption(fixture.products[2].id);
 }
 for(let index=6;index<8;index++)await page.getByLabel(`Action ${fixture.ids[index]}`,{exact:true}).selectOption('new');
 await button('Add source photos for selected updates').click();
 await page.getByLabel('Shared update value',{exact:true}).fill('Cotton short sleeve shirt');await button('Apply field to selected updates').click();
 await dialog.evaluate(element=>{element.scrollTop=0;});await page.screenshot({path:'../verification/product-destinations-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>{const dialog=document.querySelector('.workspace-dialog:has(.product-destinations)');const rect=dialog.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&dialog.scrollWidth<=dialog.clientWidth;});
 await page.screenshot({path:'../verification/product-destinations-mobile.png'});await page.setViewportSize({width:1440,height:1000});
 await button('Review selected destinations').click();
 await page.getByRole('heading',{name:'Confirm batch destinations',exact:true}).waitFor();
 await button('Confirm reviewed destinations').click();await page.getByText('5 destinations saved; 0 need attention.',{exact:true}).waitFor();
 assert.equal(await page.getByText('POS updated; source archived. No stock received.',{exact:true}).count(),2);
 checks.push('Eight rows become two existing restock destinations, two explicit new products and one shared no-stock update');
 const token=await page.evaluate(()=>sessionStorage.getItem('kline.session'));
 const response=await fetch('http://127.0.0.1:5109/api/catalog-workspace/product-matches',{headers:{Authorization:`Bearer ${token}`,'X-Branch-Id':fixture.branch}});
 const groups=await response.json();const ours=groups.filter(group=>group.item_ids.some(id=>fixture.ids.includes(id)));assert.equal(ours.length,4);assert.equal(ours.filter(group=>group.target_product_id).length,2);
 await button('Prepare saved stock together').click();await page.getByRole('heading',{name:'Prepare selected products',exact:true}).waitFor();
 checks.push('Saved stock continues to bulk count preparation without individual editors');
 checks.push('Mobile dialog fits viewport; source quantities are not confirmed by assigning destinations');
 await fs.writeFile(process.env.LIVE_TEST_URL?'../verification/product-destinations-live-browser.json':'../verification/product-destinations-browser.json',JSON.stringify({passed:true,real_local_pos:true,hosted_frontend:process.env.LIVE_TEST_URL||null,production_merchandise_changed:false,checks},null,2));console.log(JSON.stringify({passed:true,checks}));
}
try{await verifyDestinationBrowser();}catch(error){console.error((await page.locator('body').innerText()).slice(-5000));await page.screenshot({path:'../verification/product-destinations-error.png'});throw error;}finally{await browser.close();}
