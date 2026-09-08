import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
page.setDefaultTimeout(20000);
const evidence = '../.test-data/product-matching';
await fs.mkdir(evidence, { recursive: true });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const rows = Array.from({ length: 3 }, (_, i) => ({
  id: `lot-${i}`,
  name: `Formal shirt ${i}`,
  brand: i < 8 ? 'Hugo Boss' : 'Other',
  category_id: '',
  image_url: null,
  attributes: {},
  stock_quantity: 2,
  variant_lines: [
    { id: `size-${i}`, variant_attributes: { Size: 'XL' }, quantity: 2, effective_price: 100000 },
  ],
  updated_at: '2026-09-08',
  created_at: '2026-09-08',
  is_published: false,
  is_cancelled: false,
  stock_distribution_source: 'confirmed',
  blockers: [],
  batch_id: null,
  batch_title: null,
  price: 100000,
  revision: 'v1',
  status: 'ready',
}));
let saved = null;
let receiptCalls = 0;
// Intercept every matching mutation and refuse individual receipts for grouped source lots.
await page.route('**/api/catalog-workspace/product-matches**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/review'))
    return route.fulfill({
      json: {
        id: saved.id,
        revision: 'review1',
        product_name: saved.product_name,
        lot_count: 3,
        total_units: 6,
        variant_count: 1,
        new_variants: 1,
        existing_variants: 0,
        warnings: [],
        rows: [{ attributes: { size: 'XL' }, quantity: 6, price: 100000, action: 'New variant' }],
      },
    });
  if (path.endsWith('/receive')) {
    receiptCalls++;
    assert.equal(route.request().postDataJSON().expected_revision, 'review1');
    return route.fulfill({ json: { product_id: 'test-product' } });
  }
  if (route.request().method() === 'POST') {
    saved = { ...route.request().postDataJSON(), id: 'match1', revision: 'saved1' };
    return route.fulfill({ json: saved });
  }
  return route.fulfill({ json: saved ? [saved] : [] });
});
await page.route('**/api/catalog-workspace/items**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  assert.equal(route.request().method(), 'GET', 'Individual receipt must never be used for a matched lot');
  if (path.endsWith('/restock-options')) return route.fulfill({ json: [] });
  const row = rows.find((row) => path.endsWith('/' + row.id));
  return route.fulfill({
    json: row
      ? { item: row, blockers: [], publication_revision: 'lot-review' }
      : { items: rows, total: 3, total_units: 6, limit: 48 },
  });
});
const button = (name) => page.getByRole('button', { name, exact: true });
try {
  await page.goto('http://localhost:5198');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('testadmin');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('testpass123');
  await button('Sign in').click();
  await page.getByRole('tab', { name: 'Ready for POS', exact: true }).click();
  await button('Select all 3 matching lots').click();
  await button('Match product').click();
  await page.getByLabel('Product name', { exact: true }).fill('Same model 123');
  await page.getByLabel('Matching evidence', { exact: true }).fill('Model 123 on each label');
  assert(await button('Save product match').isDisabled());
  await page.getByRole('dialog').getByRole('checkbox').click();
  await page.screenshot({ path: evidence + '/match-desktop.png' });
  await button('Save product match').click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(saved.item_ids.length, 3);
  await button('Receive all ready').click();
  await page.getByRole('dialog').getByText('Same model 123', { exact: true }).waitFor();
  await page.screenshot({ path: evidence + '/matched-receipt.png' });
  await button('Receive 3 lots into Test Store').click();
  await page.getByRole('heading', { name: 'Stock received', exact: true }).waitFor();
  assert.equal(receiptCalls, 1);
  assert.deepEqual(errors, []);
  console.log(
    'PASS matching UI: evidence confirmation, saved membership, bulk product summary, one atomic group receipt.',
  );
} catch (error) {
  await page.screenshot({ path: evidence + '/failure.png' });
  console.log(await page.getByRole('dialog').innerText());
  throw error;
} finally {
  await browser.close();
}
