import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { configureTestEnvironment } from '../../server/tests/environment.cjs';

const dependencies = configureTestEnvironment();
const { pool } = dependencies.source('config/database');
// Read an actual received product's barcode; this test creates no stock or fake response.
const fixture = (
  await pool.query(`SELECT p.id,p.name,p.category_id,p.brand_id,pv.barcode,
  pv.variant_attributes->>'size' AS size FROM products p
  JOIN product_variants pv ON pv.product_id=p.id
  WHERE p.is_active=true AND pv.is_active=true AND pv.barcode IS NOT NULL
    AND p.brand_id IS NOT NULL AND pv.variant_attributes->>'size' IS NOT NULL
  ORDER BY p.created_at DESC,pv.id LIMIT 1`)
).rows[0];
await pool.end();
assert(fixture, 'Run the receiving integration fixture before this browser check.');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
const errors = [],
  checks = [];
page.on('pageerror', (error) => errors.push(error.message));
const pass = (name) => {
  checks.push(name);
  console.log('PASS', name);
};

/** Exercise real filter combinations and a scanned barcode at desktop and mobile sizes. */
try {
  await page.goto(process.env.KLINE_PREVIEW_URL || 'http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Receiving', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Stock', exact: true }).click();
  await page.locator('.stock-card').first().waitFor();
  await page.getByLabel('Filter by category').selectOption(fixture.category_id);
  await page.getByLabel('Filter by brand').selectOption(fixture.brand_id);
  await page.getByLabel('Filter by size').selectOption(fixture.size);
  const search = page.getByLabel('Search product, brand, SKU or barcode');
  const found = page.waitForResponse(
    (response) =>
      response.url().includes('/catalog-workspace/stock?') && response.url().includes(fixture.barcode),
  );
  await search.fill(fixture.barcode);
  const response = await found;
  assert.equal(response.status(), 200);
  const data = await response.json();
  assert.equal(data.products.length, 1);
  assert.equal(data.products[0].product_id, fixture.id);
  await page.locator('.stock-card').filter({ hasText: fixture.name }).waitFor();
  pass('Category, brand, size and a real barcode combine to find exactly the intended POS product');
  await page.screenshot({ path: 'verification/stock-discovery-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByLabel('Filter by category').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'verification/stock-discovery-mobile.png', fullPage: true });
  pass('Stock discovery controls fit a 360px viewport');
  await search.fill('stock-discovery-no-match-' + Date.now());
  await page.getByRole('heading', { name: 'No matching stock.' }).waitFor();
  assert.equal(await page.getByLabel('Filter by category').inputValue(), fixture.category_id);
  assert.equal(await page.getByLabel('Filter by brand').inputValue(), fixture.brand_id);
  assert((await page.getByLabel('Filter by category').locator('option').count()) > 1);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.locator('.stock-card').first().waitFor();
  assert.equal(await search.inputValue(), '');
  assert.equal(await page.getByLabel('Filter by category').inputValue(), '');
  assert.equal(await page.getByLabel('Filter by brand').inputValue(), '');
  assert.equal(await page.getByLabel('Filter by size').inputValue(), '');
  pass('Empty results preserve filter choices and Clear filters restores stock on mobile');
  assert.deepEqual(errors, []);
  await fs.writeFile(
    'verification/stock-discovery-browser.json',
    JSON.stringify({ passed: true, checked_at: new Date().toISOString(), checks }, null, 2),
  );
} finally {
  await browser.close();
}
