import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = path.join(root, 'verification');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
const errors = [],
  checks = [];
page.on('pageerror', (error) => errors.push(error.message));
const pass = (name) => {
  checks.push(name);
  console.log('PASS', name);
};
const snapshot = async (name) => {
  await page.waitForTimeout(180);
  return page.screenshot({
    path: path.join(evidence, name + '.png'),
    fullPage: !(await page.getByRole('dialog').count()),
  });
};

/** Exercise the UI against the real local POS host, including a deliberately interrupted upload. */
try {
  await page.goto(process.env.KLINE_PREVIEW_URL || 'http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Receiving', exact: true }).waitFor();
  const deliveryName = 'September delivery';
  await page.getByRole('button', { name: 'New delivery', exact: true }).first().click();
  await page.getByLabel('Delivery name').fill(deliveryName);
  await page
    .getByLabel('Delivery photos')
    .setInputFiles([0, 1, 2].map((index) => path.join(root, `design/assets/item-${index}.jpg`)));
  let interrupted = false;
  await page.route('**/api/catalog/items', (route) => {
    if (!interrupted && route.request().method() === 'POST') {
      interrupted = true;
      return route.abort('connectionreset');
    }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Add to Receiving' }).click();
  await page.getByRole('button', { name: 'Resume uploads' }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Receiving', exact: true }).waitFor();
  await page.getByRole('button', { name: 'New delivery', exact: true }).first().click();
  await page.getByRole('button', { name: 'Resume uploads' }).click();
  await page.getByRole('heading', { name: deliveryName, exact: true }).waitFor();
  await page.locator('.receiving-row').first().waitFor();
  assert.equal(await page.locator('.receiving-row').count(), 3);
  pass('Interrupted photo uploads resume into one persistent delivery');
  const names = ['Studio pleated trousers', 'Studio cotton chinos', 'Studio straight-leg trousers'];
  for (let index = 0; index < 3; index++) {
    await page.locator('.receiving-identity').nth(index).click();
    await page.getByLabel('Product name', { exact: true }).fill(names[index]);
    await page.getByLabel('Brand', { exact: true }).fill('K-Line');
    await page.getByLabel('Material', { exact: true }).fill('Cotton');
    await page.getByRole('button', { name: 'Save details', exact: true }).click();
    await page.getByText('Details saved', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Sizes & quantities' }).click();
    await page.getByLabel('Size 1', { exact: true }).fill('30');
    await page.getByLabel('Quantity 1', { exact: true }).fill('1');
    if (index === 0) {
      await page.getByRole('button', { name: 'Add size', exact: true }).click();
      await page.getByLabel('Size 2', { exact: true }).fill('32');
      await page.getByLabel('Quantity 2', { exact: true }).fill('2');
      await page.getByRole('button', { name: 'Add size', exact: true }).click();
      await page.getByLabel('Size 3', { exact: true }).fill('34');
      await page.getByLabel('Quantity 3', { exact: true }).fill('3');
    }
    await page.getByRole('button', { name: `Confirm ${index === 0 ? 6 : 1} units`, exact: true }).click();
    await page.getByText('Size quantities confirmed', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
  }
  pass('Details and multi-size counts save without a separate approval screen');
  await snapshot('receiving-desktop');
  for (const name of names) await page.getByRole('checkbox', { name: `Select ${name}`, exact: true }).check();
  await page.getByRole('button', { name: 'Price', exact: true }).click();
  await page.getByRole('heading', { name: 'Pricing', exact: true }).waitFor();
  await page.getByLabel('Shared price').fill('0');
  await page.getByRole('button', { name: 'Review prices', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'positive price' }).waitFor();
  pass('Zero selling prices fail before review');
  await page.getByLabel('Shared price').fill('90000');
  await page.getByRole('button', { name: 'Add exception', exact: true }).click();
  await page.getByRole('combobox', { name: 'Size for exception 1', exact: true }).click();
  await page.getByRole('option', { name: '34', exact: true }).click();
  await page.getByLabel('Price for exception 1', { exact: true }).fill('100000');
  await snapshot('pricing-desktop');
  await page.setViewportSize({ width: 360, height: 800 });
  await snapshot('pricing-mobile');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole('button', { name: 'Review prices', exact: true }).click();
  const review = page.getByRole('dialog');
  await review.getByRole('heading', { name: 'Review prices' }).waitFor();
  assert((await review.innerText()).includes('100,000'));
  assert((await review.innerText()).includes('8 units'));
  await snapshot('pricing-review-mobile');
  await review.getByRole('button', { name: 'Save prices', exact: true }).click();
  await page.getByRole('heading', { name: 'Prices saved' }).waitFor();
  await page.getByRole('button', { name: 'Return to Receiving' }).click();
  await page.getByRole('heading', { name: deliveryName, exact: true }).waitFor();
  pass('Selection, shared price, size exception, exact review and save complete on mobile');
  for (const name of names) await page.getByRole('checkbox', { name: `Select ${name}`, exact: true }).check();
  await page.getByRole('button', { name: 'Price', exact: true }).click();
  await page.getByRole('tab', { name: 'Costs', exact: true }).click();
  await page.getByRole('button', { name: /^Select all .* matches$/ }).click();
  await page.getByLabel('Shared price').fill('45000');
  await page.getByRole('button', { name: 'Review costs', exact: true }).click();
  await page.getByRole('button', { name: 'Save prices', exact: true }).click();
  await page.getByRole('heading', { name: 'Prices saved' }).waitFor();
  await page.getByRole('button', { name: 'Return to Receiving' }).click();
  await page.getByRole('heading', { name: deliveryName, exact: true }).waitFor();
  for (const name of names) await page.getByRole('checkbox', { name: `Select ${name}`, exact: true }).check();
  await page.getByRole('button', { name: 'Review receipt', exact: true }).click();
  let changedAfterReview = false;
  await page.route('**/api/catalog-workspace/items/*/receive', async (route) => {
    /* Commit a real competing edit after review; the pending receipt must reject its old token. */
    assert.match(route.request().postDataJSON().expected_revision, /^[a-f0-9]{64}$/);
    if (!changedAfterReview) {
      changedAfterReview = true;
      const itemUrl = route
        .request()
        .url()
        .replace(/\/receive$/, '');
      const headers = await route.request().allHeaders();
      const detailResponse = await page.request.get(itemUrl, { headers });
      assert.equal(detailResponse.status(), 200);
      const detail = await detailResponse.json();
      const edit = await page.request.patch(itemUrl, {
        headers,
        data: {
          expected_revision: detail.revision,
          name: detail.item.name + ' reviewed',
          brand: detail.item.brand,
          category_id: detail.item.category_id,
          attributes: detail.item.attributes,
        },
      });
      assert.equal(edit.status(), 200);
    }
    await route.continue();
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Receive into POS', exact: true }).click();
  await page.getByRole('button', { name: 'Review changed lots', exact: true }).waitFor();
  await page.getByText('This lot changed. Review it again before receiving.', { exact: true }).waitFor();
  await snapshot('receipt-stale-mobile');
  await page.getByRole('button', { name: 'Review changed lots', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('cell', { name: /reviewed/ })
    .first()
    .waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Retry unresolved lots', exact: true }).click();
  await page.getByRole('heading', { name: 'Delivery received', exact: true }).waitFor();
  await page.unroute('**/api/catalog-workspace/items/*/receive');
  pass('A real edit after review requires a fresh receipt review while completed lots stay received');
  await snapshot('receipt-mobile');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('tab', { name: 'Receipts', exact: true }).click();
  await page.locator('.receipt-row').first().waitFor();
  assert.equal(await page.locator('.receipt-row').count(), 3);
  pass('Three lots receive eight units and leave durable per-lot receipts');
  await page.getByRole('button', { name: 'Stock', exact: true }).click();
  await page.getByLabel('Search product, brand, SKU or barcode').fill('Studio');
  await page.locator('.stock-card').filter({ hasText: names[0] }).first().waitFor();
  await snapshot('stock-mobile');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({ width: 1366, height: 1000 });
  await snapshot('stock-desktop');
  await page.getByRole('button', { name: 'Use dark appearance' }).click();
  await snapshot('stock-dark');
  await page.locator('.stock-card').filter({ hasText: names[0] }).first().click();
  await page.getByRole('heading', { name: 'Recent movements', exact: true }).waitFor();
  await snapshot('stock-detail-desktop');
  await page.setViewportSize({ width: 360, height: 800 });
  await snapshot('stock-detail-mobile');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  pass('Current-stock cards, movement history and dark appearance work at desktop and 360px');
  // A failed refresh must retain the explicitly timestamped snapshot, never display false zeroes.
  await page.route('**/api/catalog-workspace/stock?**', (route) => route.abort('connectionreset'));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'last successful update' }).waitFor();
  assert((await page.locator('.stock-card').count()) >= 3);
  pass('Failed refresh retains timestamped stock with an explicit stale state');
  assert.deepEqual(errors, []);
  pass('No uncaught browser errors');
  await fs.writeFile(
    path.join(evidence, 'browser.json'),
    JSON.stringify({ passed: true, checked_at: new Date().toISOString(), checks }, null, 2),
  );
} catch (error) {
  await snapshot('browser-failure');
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
