import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
page.setDefaultTimeout(20000);
const evidence = '../.test-data/bulk-receiving';
await fs.mkdir(evidence, { recursive: true });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const rows = Array.from({ length: 1001 }, (_, i) => ({
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
  blockers: i === 1000 ? ['Confirm stock breakdown'] : [],
  batch_id: null,
  batch_title: null,
  price: 100000,
  revision: 'v1',
  status: 'ready',
}));
const attempts = new Map();
const revisions = new Map();
const postedRevisions = new Map();
let reviewReads = 0;
// Every merchandise mutation is intercepted, so no test receipt can reach a POS.
await page.route('**/api/catalog-workspace/items**', async (route) => {
  const url = new URL(route.request().url());
  const match = url.pathname.match(/\/items\/(lot-\d+)(\/receive)?$/);
  if (match) {
    const row = rows.find((item) => item.id === match[1]);
    if (match[2]) {
      assert.equal(route.request().method(), 'POST');
      const revision = route.request().postDataJSON().expected_revision;
      assert.equal(revision, revisions.get(row.id));
      postedRevisions.set(row.id, [...(postedRevisions.get(row.id) || []), revision]);
      attempts.set(row.id, (attempts.get(row.id) || 0) + 1);
      if (row.id === 'lot-1' && attempts.get(row.id) === 1)
        return route.fulfill({ status: 503, json: { message: 'Temporary receiving failure' } });
      if (row.id === 'lot-8' && attempts.get(row.id) === 1)
        return route.fulfill({ status: 409, json: { message: 'Price changed since review' } });
      row.is_published = true;
      return route.fulfill({ json: { data: { item_id: row.id } } });
    }
    reviewReads++;
    revisions.set(row.id, `pinned-${reviewReads}`);
    return route.fulfill({
      json: {
        item: row,
        blockers: row.id === 'lot-0' ? ['Count changed: confirm sizes'] : row.blockers,
        publication_revision: revisions.get(row.id),
      },
    });
  }
  assert.equal(route.request().method(), 'GET');
  const filtered = rows.filter((row) => url.searchParams.get('task') !== 'incoming' || !row.is_published);
  const start = (Number(url.searchParams.get('page') || 1) - 1) * 48;
  return route.fulfill({
    json: {
      items: filtered.slice(start, start + 48),
      total: filtered.length,
      total_units: filtered.length * 2,
      limit: 48,
    },
  });
});
const button = (name) => page.getByRole('button', { name, exact: true });
const tab = (name) => page.getByRole('tab', { name, exact: true });
const check = (name) => page.getByRole('checkbox', { name, exact: true });
const text = (name) => page.getByText(name, { exact: true }).waitFor();
/** Cover large selections and safe partial receipt outcomes through the actual rendered workspace. */
async function verifyBulkReceiving() {
  await page.goto('http://localhost:5198');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('testadmin');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('testpass123');
  await button('Sign in').click();
  await tab('Ready for POS').click();
  await button('Select all 1000 matching lots').waitFor();
  await check('Select this page').check();
  await text('48 lots / 96 units selected');
  await button('Select all 1000 matching lots').click();
  await text('1000 lots / 2,000 units selected');
  await check('Select Formal shirt 0').uncheck();
  await button('Next').click();
  await text('999 lots / 1,998 units selected');
  assert(await check('Select Formal shirt 48').isChecked());
  await button('Clear').click();
  await page.getByRole('combobox', { name: 'Receiving brand', exact: true }).click();
  await page.getByRole('option', { name: 'Hugo Boss', exact: true }).click();
  await button('Select all 8 matching lots').waitFor();
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  await page.screenshot({ path: `${evidence}/ready-desktop.png`, animations: 'disabled' });
  await button('Ready for POS').nth(1).click();
  await button('Receive 1 lot into Test Store').waitFor();
  await button('Back').click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await button('Receive all ready').click();
  await text('1 lot needs attention');
  assert.equal(await page.getByRole('dialog').locator('.receiving-review-group[open]').count(), 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${evidence}/bulk-confirmation.png`, animations: 'disabled' });
  await button('Receive 7 lots into Test Store').click();
  await button('Retry unresolved lots').waitFor();
  assert.equal(attempts.has('lot-0'), false);
  await button('Retry unresolved lots').click();
  await page.getByRole('heading', { name: 'Stock received', exact: true }).waitFor();
  assert.equal(attempts.get('lot-1'), 2);
  for (let i = 2; i < 8; i++) assert.equal(attempts.get(`lot-${i}`), 1);
  assert.equal(reviewReads, 9);
  await button('View stock').waitFor();
  await button('View receipts').click();
  await tab('Ready for POS').click();
  await page.getByRole('combobox', { name: 'Receiving brand', exact: true }).click();
  await page.getByRole('option', { name: 'All brands', exact: true }).click();
  await button('Select all 993 matching lots').waitFor();
  await page
    .locator('.receiving-row')
    .filter({ has: check('Select Formal shirt 8') })
    .getByRole('button', { name: 'Ready for POS', exact: true })
    .click();
  await button('Receive 1 lot into Test Store').click();
  await button('Review changed lots').click();
  await button('Receive 1 lot into Test Store').click();
  await button('View stock').waitFor();
  assert.notEqual(postedRevisions.get('lot-8')[0], postedRevisions.get('lot-8')[1]);
  await button('View stock').click();
  await page.getByRole('heading', { name: 'Stock', exact: true }).waitFor();
  await page
    .getByRole('navigation', { name: 'Workspace', exact: true })
    .getByRole('button', { name: 'Receiving', exact: true })
    .click();
  await tab('Preparation').click();
  await page.getByRole('combobox', { name: 'Receiving brand', exact: true }).click();
  await page.getByRole('option', { name: 'All brands', exact: true }).click();
  await button('Select all 1 matching lots').waitFor();
  assert.equal(await page.locator('.receiving-row').count(), 1);
  await tab('Ready for POS').click();
  await button('Select all 992 matching lots').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await check('Select this page').check();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${evidence}/ready-mobile.png` });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: 1000-lot selection, page persistence, brand filter, direct receipt, grouped review, excluded blockers, partial failure, safe retry, changed-revision re-review, stock navigation, completion, preparation queue, mobile bounds.',
  );
}
try {
  await verifyBulkReceiving();
} catch (error) {
  await page.screenshot({ path: `${evidence}/failure.png` });
  console.log((await page.locator('body').innerText()).slice(0, 2600));
  console.log(
    await page.getByRole('checkbox').evaluateAll((nodes) => nodes.slice(0, 3).map((node) => node.outerHTML)),
  );
  throw error;
} finally {
  await browser.close();
}
