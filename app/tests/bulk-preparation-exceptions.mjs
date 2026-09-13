import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const fixture = JSON.parse(await fs.readFile('../.test-data/bulk-exceptions-fixture.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
const button = name => page.getByRole('button', { name, exact: true });
let token;
async function localRequest(route, body) {
  const response = await fetch(`http://127.0.0.1:5109/api/catalog-workspace${route}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'X-Branch-Id': fixture.branch, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
try {
  // Hosted frontend checks use isolated local API fixtures and cannot mutate production merchandise.
  if (process.env.LIVE_TEST_URL) await page.route('**/api/**', async route => {
    const request = route.request();
    const source = new URL(request.url());
    const headers = { ...request.headers() };
    delete headers.host; delete headers.origin; delete headers['content-length'];
    const response = await fetch(`http://127.0.0.1:5109${source.pathname}${source.search}`, {
      method: request.method(), headers,
      ...(['GET', 'HEAD'].includes(request.method()) ? {} : { body: request.postDataBuffer() }),
    });
    await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/json' }, body: Buffer.from(await response.arrayBuffer()) });
  });
  await page.goto(process.env.LIVE_TEST_URL || 'http://localhost:5198');
  await page.getByLabel('Username', { exact: true }).fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await button('Sign in').click();
  await page.getByRole('radio', { name: 'Test Store', exact: true }).check();
  await button('Enter workspace').click();
  token = await page.evaluate(() => sessionStorage.getItem('kline.session'));
  const before = await Promise.all(fixture.ids.map(id => localRequest(`/items/${id}`)));
  await localRequest('/product-matches', { item_ids: [fixture.ids[0], fixture.ids[2]], product_name: 'Bulk exception group', brand_name: 'Bulk fixture', variant_defaults: {}, review_note: 'Local batch workflow test', confirm_differences: true });
  await page.getByRole('button').filter({ hasText: fixture.title }).click();
  await button('Select all 3 source lots').click();
  await button('Prepare selected').click();
  await button('Resolve photos, categories and groups').click();
  await page.getByRole('heading', { name: 'Resolve batch requirements', exact: true }).waitFor();
  await page.getByLabel('Batch replacement photos').setInputFiles([
    { name: 'first.jpg', mimeType: 'image/jpeg', buffer: await fs.readFile('../design/assets/item-0.jpg') },
    { name: 'second.jpg', mimeType: 'image/jpeg', buffer: await fs.readFile('../design/assets/item-0.jpg') },
  ]);
  await page.getByLabel('Product for first.jpg').selectOption(fixture.ids[0]);
  await page.getByLabel('Product for second.jpg').selectOption(fixture.ids[1]);
  await button('Attach assigned photos').click();
  await page.getByText('Photo attached', { exact: true }).nth(1).waitFor();
  await button('Check selected groups').click();
  await button('Return selected groups to separate lots').click();
  await button('Confirm ungrouping selected groups').click();
  await page.getByText('Bulk exception group â€” 2 source lots', { exact: true }).waitFor({ state: 'hidden' });
  const mapping = page.getByLabel('POS category Bulk preparation test shirts');
  const alternatives = await mapping.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
  const other = alternatives.find(id => id !== fixture.target);
  assert(other, 'Local fixture must contain another POS category');
  await mapping.selectOption(other);
  await button('Save category connections').click();
  await page.getByText('Category connected', { exact: true }).waitFor();
  await mapping.selectOption(fixture.target);
  await button('Save category connections').click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Save category connections')?.disabled);
  const mappings = await localRequest('/category-mappings');
  assert.equal(mappings.categories.find(row => row.id === fixture.category).pos_category_id, fixture.target);
  await button('Back to batch preparation').click();
  await page.getByText('Choose shared actions or edit the table, then save the batch.', { exact: true }).waitFor();
  await button('Refresh selected readiness').waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Refresh selected readiness')?.disabled);
  await page.getByRole('dialog', { name: 'Prepare selected products', exact: true }).evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: '../verification/bulk-preparation-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const dialog = document.querySelector('.workspace-dialog:has(.bulk-preparation)');
    const box = dialog.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth;
  });
  await page.screenshot({ path: '../verification/bulk-preparation-mobile.png' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const after = await Promise.all(fixture.ids.map(id => localRequest(`/items/${id}`)));
  assert(after.slice(0, 2).every((detail, index) => detail.revision !== before[index].revision));
  assert(after.every((detail, index) => detail.item.stock_quantity === before[index].item.stock_quantity && !detail.item.is_published));
  const groups = await localRequest('/product-matches');
  assert(!groups.some(group => group.item_ids.includes(fixture.ids[0])));
  const checks = ['Two explicitly assigned photos attached together', 'Group checked and returned to separate lots in batch', 'Category mapping saved and changed again with fresh revision', 'Source quantities preserved; no stock received', 'Mobile batch has no page overflow'];
  await fs.writeFile(process.env.LIVE_TEST_URL ? '../verification/bulk-preparation-live-browser.json' : '../verification/bulk-preparation-exceptions.json', JSON.stringify({ passed: true, real_local_pos: true, frontend: process.env.LIVE_TEST_URL || 'local', checks }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }));
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(-5000));
  throw error;
} finally { await browser.close(); }

