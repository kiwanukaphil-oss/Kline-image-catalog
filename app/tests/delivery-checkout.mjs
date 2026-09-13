import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
page.setDefaultTimeout(20000);
const errors = [],
  sent = [],
  saves = [];
page.on('pageerror', (e) => errors.push(e.message));
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
let items = ids.map((id, n) => ({
  id,
  name: `Cotton shirt ${n + 1}`,
  brand: 'Oxford',
  image_url: null,
  attributes: { material: 'Cotton' },
  revision: 'a'.repeat(64),
  is_published: false,
  is_cancelled: false,
  has_size: true,
  count_source: 'ai_suggested',
  required_fields: [],
  issues: [],
  lines: [{ id: `line${n}`, size: n ? 'XXL' : 'M', quantity: 2, price: null, cost: null }],
}));
// Intercept every API request: UI verification cannot modify hosted records.
await page.route('**/api/**', async (route) => {
  const path = new URL(route.request().url()).pathname,
    body = route.request().postDataJSON(),
    respond = (json) => route.fulfill({ json });
  if (path.endsWith('/auth/login'))
    return respond({ token: 'fixture', user: { id: 'user', default_branch_id: 'main' } });
  if (path.endsWith('/auth/me')) return respond({ user: { id: 'user', default_branch_id: 'main' } });
  if (path.endsWith('/catalog/session'))
    return respond({
      data: {
        id: 'user',
        username: 'fixture',
        branches: [{ id: 'main', name: 'MAIN', can_switch_to: true }],
        can_edit: true,
        can_upload: true,
        can_publish: true,
        can_view_cost: true,
        can_ai_extract: true,
        can_open_pos_product: true,
      },
    });
  if (path.endsWith('/catalog/reference-data')) return respond({ data: { categories: [], fields: [] } });
  if (path.endsWith('/product-matches')) return respond([]);
  if (path.endsWith('/ai-batches')) return respond({ batches: [] });
  if (path.endsWith('/delivery/read'))
    return respond({ results: items.map((item) => ({ id: item.id, item })), expanded: 0, groups: [] });
  if (path.endsWith('/delivery/save')) {
    saves.push(body);
    items = items.map((item) => ({
      ...item,
      ...body.rows.find((row) => row.id === item.id),
      revision: 'b'.repeat(64),
    }));
    return respond({ results: items.map((item) => ({ id: item.id, item })) });
  }
  if (path.endsWith('/delivery/review'))
    return respond({
      results: items
        .filter((i) => body.item_ids.includes(i.id))
        .map((item) => ({
          unit: { id: item.id, group: false, item_ids: [item.id] },
          item_ids: [item.id],
          revision: 'c'.repeat(64),
          name: item.name,
          outcome: 'New product',
          rows: item.lines.map((l) => ({
            size: l.size,
            quantity: Number(l.quantity),
            price: Number(l.price),
          })),
        })),
    });
  if (path.endsWith('/delivery/send')) {
    sent.push(body.review.unit.id);
    return respond({ received: true, item_ids: body.review.item_ids });
  }
  if (path.endsWith('/catalog-workspace/items'))
    return respond({
      items: items.map((i) => ({
        ...i,
        variant_lines: i.lines,
        stock_quantity: 2,
        blockers: ['Enter retail price.', 'Confirm stock breakdown.'],
        batch_id: null,
      })),
      total: 2,
      limit: 48,
    });
  return respond({ items: [], total: 0, total_units: 0, limit: 48 });
});
const button = (name) => page.getByRole('button', { name, exact: true });
try {
  await page.goto(process.env.KLINE_PREVIEW_URL || 'http://localhost:5203');
  await page.getByLabel('Username', { exact: true }).fill('fixture');
  await page.getByLabel('Password', { exact: true }).fill('fixture');
  await button('Sign in').click();
  await page.getByRole('radio', { name: 'MAIN', exact: true }).check();
  await button('Enter workspace').click();
  await page.getByRole('tab', { name: 'Incoming', exact: true }).click();
  await button('Select all 2 source lots').click();
  assert.equal(await button('Prepare selected').count(), 0);
  assert.equal(await button('Choose destinations').count(), 0);
  await page.locator('.selection-bar').getByRole('button', { name: 'Price items', exact: true }).click();
  await page.getByRole('heading', { name: 'Price items', exact: true }).waitFor();
  await page.locator('.delivery-bulk').getByLabel('Selling price / UGX', { exact: true }).fill('90000');
  await page.locator('.delivery-bulk').getByLabel('Cost / UGX', { exact: true }).fill('40000');
  await button('Apply to selected').click();
  await page.getByLabel(`Quantity ${ids[0]} 1`, { exact: true }).fill('3');
  await page.screenshot({ path: '../verification/delivery-pricing-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../verification/delivery-pricing-mobile.png', fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await button('Review for POS').click();
  await page.getByRole('heading', { name: 'Review for POS', exact: true }).waitFor();
  assert.equal(await page.locator('.delivery-checkout input').count(), 0);
  assert.equal(saves[0].rows.length, 2);
  assert.equal(sent.length, 0);
  await button('Back to pricing').click();
  assert.equal(await page.getByLabel(`Quantity ${ids[0]} 1`, { exact: true }).inputValue(), '3');
  await button('Review for POS').click();
  await page.screenshot({ path: '../verification/delivery-summary-mobile.png', fullPage: true });
  await button('Send 2 products to POS').click();
  await page.getByRole('heading', { name: 'Sent to POS', exact: true }).waitFor();
  assert.equal(sent.length, 2);
  assert.deepEqual(errors, []);
  const checks = [
    'Main flow hides technical tools',
    'Bulk pricing and costs save together',
    'Mobile fits viewport',
    'Summary is read-only; back preserves edits',
    'Explicit send completes two products',
  ];
  await fs.writeFile(
    '../verification/delivery-checkout-ui.json',
    JSON.stringify({ passed: true, checks }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, checks }));
} finally {
  await browser.close();
}
