import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

const catalog = 'https://catalog-web-production-2d56.up.railway.app';
const api = 'https://pos-api-production-07c3.up.railway.app/api';
const posOrigin = 'https://pos-web-production-fee4.up.railway.app';
const configuration = JSON.parse(
  (await fs.readFile('../.test-data/railway-staging-private.json', 'utf8')).replace(/^\uFEFF/, ''),
);
assert.equal(configuration.database.RAILWAY_PROJECT_ID, '9ce0cab6-9ab1-4da3-854b-afcf4cfa914b');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
let pos;
const checks = [];

/** Use the separate POS login form and retain the protected link's destination. */
async function loginPos() {
  await pos.getByRole('textbox', { name: /Username/ }).fill(configuration.account.username);
  await pos.getByLabel(/^Password/).fill(configuration.account.password);
  await pos.getByRole('button', { name: 'Sign In', exact: true }).click();
}

try {
  // Validate actual HTTPS, CORS, object storage and both frontend runtimes without mocks.
  await page.goto(catalog);
  await page.getByLabel('Username').fill(configuration.account.username);
  await page.getByLabel('Password', { exact: true }).fill(configuration.account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Receiving', exact: true }).waitFor();
  const branch = await page.getByLabel('Active branch').inputValue();
  const token = await page.evaluate(() => sessionStorage.getItem('kline.session'));
  const response = await page.request.get(`${api}/catalog-workspace/stock?search=Studio`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Branch-Id': branch },
  });
  assert.equal(response.status(), 200);
  const stock = await response.json();
  assert.equal(stock.products.length, 3);
  assert.equal(
    stock.products.reduce((sum, product) => sum + product.quantity, 0),
    8,
  );
  checks.push('Three received lots total exactly eight units in real staging POS stock');
  const hashes = await Promise.all(
    [0, 1, 2].map(async (index) =>
      createHash('sha256')
        .update(await fs.readFile(`../design/assets/item-${index}.jpg`))
        .digest('hex'),
    ),
  );
  for (const product of stock.products) {
    assert(product.image_url, 'Received product must have its transferred photo');
    const photo = await page.request.get(product.image_url);
    assert.equal(photo.status(), 200);
    assert(
      hashes.includes(
        createHash('sha256')
          .update(await photo.body())
          .digest('hex'),
      ),
    );
    const unsigned = new URL(product.image_url);
    unsigned.search = '';
    const denied = await page.request.get(unsigned.toString());
    assert([401, 403].includes(denied.status()), 'Photos must not be publicly readable');
  }
  checks.push('All three original photos survive handoff byte-for-byte; unsigned bucket requests are denied');
  await page.getByRole('button', { name: 'Stock', exact: true }).click();
  await page.getByLabel('Search product, brand, SKU or barcode').fill('Studio');
  const product = stock.products[0];
  await page.locator('.stock-card').filter({ hasText: product.name }).click();
  const href = await page.getByRole('link', { name: 'Prices in POS' }).getAttribute('href');
  assert.equal(new URL(href).origin, posOrigin);
  assert.equal(new URL(href).searchParams.get('branch_id'), branch);
  assert(!/token|password|bearer/i.test(href));
  const opened = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Prices in POS' }).click();
  pos = await opened;
  await loginPos();
  await pos.waitForURL(`**/products/${product.product_id}?tab=pricing`);
  assert.equal(await pos.getByRole('tab', { name: /Pricing/ }).getAttribute('aria-selected'), 'true');
  assert.equal(await pos.evaluate(() => localStorage.getItem('selected_branch_id')), branch);
  await pos.screenshot({ path: '../verification/railway/pos-pricing.png' });
  const stockLink = new URL(href);
  stockLink.searchParams.set('action', 'stock');
  await pos.goto(stockLink.toString());
  await pos.waitForURL(`**/products/${product.product_id}?tab=variants`);
  assert.equal(
    await pos.getByRole('tab', { name: /Variants & stock/ }).getAttribute('aria-selected'),
    'true',
  );
  await pos.evaluate(() => localStorage.setItem('token', 'expired-staging-check'));
  await pos.goto(href);
  await loginPos();
  await pos.waitForURL(`**/products/${product.product_id}?tab=pricing`);
  const forbidden = new URL(href);
  forbidden.searchParams.set('branch_id', randomUUID());
  await pos.goto(forbidden.toString());
  await pos.getByText('Your POS account cannot access this branch.', { exact: true }).waitFor();
  checks.push('POS price/stock deep links, branch context, expired login and denied branches pass on HTTPS');
  await fs.writeFile(
    '../verification/railway/handoff.json',
    JSON.stringify(
      {
        passed: true,
        checked_at: new Date().toISOString(),
        catalog,
        pos: posOrigin,
        checks,
      },
      null,
      2,
    ),
  );
  for (const check of checks) console.log('PASS', check);
} finally {
  await browser.close();
}
