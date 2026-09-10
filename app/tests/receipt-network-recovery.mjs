import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const rows = ['first','second','third'].map((id) => ({ id, name: `Test shirt ${id}`, brand:'Test', category_id:'shirts',
  attributes:{size:'L'}, stock_quantity:1, stock_distribution_source:'human_confirmed', is_published:false,
  blockers:[], variant_lines:[{id:`line-${id}`,variant_attributes:{size:'L'},quantity:1,effective_price:90000}],
  price:90000,revision:'v1',status:'draft',image_url:null,batch_id:null,batch_title:null }));
const group = {id:'group',item_ids:['first','second'],product_name:'Test matched shirts',brand_name:'Test',target_product_id:null,variant_defaults:{},review_note:'Fixture',revision:'g1'};
let groupWrites=0, singleWrites=0;
await page.addInitScript(() => {sessionStorage.setItem('kline.session','fixture');sessionStorage.setItem('kline.branch','test');});
// Every API request is intercepted; the simulated lost acknowledgement cannot create real stock.
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  const reply = json => route.fulfill({json});
  if (path.endsWith('/catalog/session')) return reply({data:{id:'user',username:'fixture',full_name:'Fixture',branches:[{id:'test',name:'Test branch',code:'T',can_switch_to:true}],default_branch_id:'test',can_publish:true,can_open_pos_product:true,can_edit:false,can_upload:false,can_ai_extract:false}});
  if (path.endsWith('/catalog/reference-data')) return reply({data:{categories:[],fields:[]}});
  if (path.endsWith('/product-matches/group/review')) return reply({id:'group',product_name:group.product_name,revision:'r1',lot_count:2,total_units:2,variant_count:1,new_variants:1,existing_variants:0,warnings:[],rows:[{attributes:{size:'L'},quantity:2,price:90000,action:'New variant'}]});
  if (path.endsWith('/product-matches/group/receive')) {
    groupWrites++;
    rows[0].is_published=rows[1].is_published=true;
    return route.abort('connectionreset');
  }
  if (path.endsWith('/product-matches')) return reply(groupWrites ? [] : [group]);
  if (path.endsWith('/match-suggestions')) return reply({suggestions:[],eligible_lots:3,evidence_lots:0});
  const item = rows.find(row => path.endsWith(`/items/${row.id}`) || path.endsWith(`/items/${row.id}/receive`));
  if (item && path.endsWith('/receive')) {
    assert.equal(item.id,'third','A committed group must not be received again');
    singleWrites++;item.is_published=true;
    return reply({item_id:item.id});
  }
  if (item) return reply({item,blockers:[],publication_revision:'p1'});
  if (path.endsWith('/items')) return reply({items:rows,total:3,total_units:3,limit:48});
  if (route.request().method() !== 'GET') throw new Error(`Unexpected mutation: ${path}`);
  return reply({items:[],total:0,limit:48});
});
try {
  await page.goto('http://127.0.0.1:5199');
  await page.getByRole('tab',{name:'Ready for POS',exact:true}).click();
  await page.getByText('3 source lots → 2 POS products · 3 confirmed units',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Receive all ready',exact:true}).click();
  await page.getByRole('button',{name:'Receive 3 lots into Test branch',exact:true}).click();
  await page.getByText('Connection interrupted. Some stock may already have been received. Reload the review to check saved receipts before retrying.',{exact:true}).waitFor();
  assert.equal(groupWrites,1);assert.equal(singleWrites,0);
  await page.getByRole('button',{name:'Review changed lots',exact:true}).click();
  await page.getByRole('button',{name:'Receive 1 lot into Test branch',exact:true}).click();
  await page.getByRole('heading',{name:'Stock received',exact:true}).waitFor();
  assert.equal(groupWrites,1);assert.equal(singleWrites,1);
  await page.screenshot({path:'../verification/receipt-network-recovery.png'});
  await fs.writeFile('../verification/receipt-network-recovery.json',JSON.stringify({passed:true,group_writes:groupWrites,single_writes:singleWrites,stopped_after_disconnect:true,committed_group_not_replayed:true},null,2));
  console.log('PASS receipt stops after lost acknowledgement, re-reads saved stock and does not duplicate the group');
} catch(error) {console.error((await page.locator('body').innerText()).slice(-5000));throw error;}
finally {await browser.close();}
