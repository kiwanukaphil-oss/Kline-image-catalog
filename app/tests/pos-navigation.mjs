import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { configureTestEnvironment } from '../../server/tests/environment.cjs';
const dependencies = configureTestEnvironment(),
  { pool } = dependencies.source('config/database');
const fixture = (
  await pool.query(`SELECT pv.product_id,pv.sku,b.id AS branch_id FROM product_variants pv
  JOIN branch_inventory bi ON bi.variant_id=pv.id JOIN branches b ON b.id=bi.branch_id
  WHERE pv.sku='TSH-S-BLU' AND b.name='Stock flow destination' ORDER BY b.created_at DESC LIMIT 1`)
).rows[0];
assert(fixture);
await pool.end();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
let pos;
/** Authenticate through the actual POS login form after a protected-link redirect. */
async function loginPos() {
  await pos.getByRole('textbox', { name: /Username/ }).fill('testadmin');
  await pos.getByLabel(/^Password/).fill('testpass123');
  await pos.getByRole('button', { name: 'Sign In', exact: true }).click();
}
try {
  // The two apps start with separate sessions; no credential is transported in the handoff URL.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Active branch').selectOption(fixture.branch_id);
  await page.getByRole('button', { name: 'Stock', exact: true }).click();
  await page.getByLabel('Search product, brand, SKU or barcode').fill(fixture.sku);
  await page.locator('.stock-card').click();
  const href = await page.getByRole('link', { name: 'Prices in POS' }).getAttribute('href');
  assert.equal(new URL(href).searchParams.get('branch_id'), fixture.branch_id);
  assert(!/token|password|bearer/i.test(href));
  const popup = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Prices in POS' }).click();
  pos = await popup;
  await loginPos();
  await pos.waitForURL(`**/products/${fixture.product_id}?tab=pricing`);
  await pos.getByRole('tab', { name: /Pricing/ }).waitFor();
  assert.equal(await pos.getByRole('tab', { name: /Pricing/ }).getAttribute('aria-selected'), 'true');
  assert.equal(await pos.evaluate(() => localStorage.getItem('selected_branch_id')), fixture.branch_id);
  await pos.screenshot({ path: '../verification/pos-handoff-desktop.png' });
  const stockUrl = new URL(href);
  stockUrl.searchParams.set('action', 'stock');
  await pos.goto(stockUrl.toString());
  await pos.waitForURL(`**/products/${fixture.product_id}?tab=variants`);
  assert.equal(
    await pos.getByRole('tab', { name: /Variants & stock/ }).getAttribute('aria-selected'),
    'true',
  );
  // Expired POS credentials must return through login and preserve the requested destination.
  await pos.evaluate(() => localStorage.setItem('token', 'expired-test-token'));
  await pos.goto(href);
  await loginPos();
  await pos.waitForURL(`**/products/${fixture.product_id}?tab=pricing`);
  const denied = new URL(href);
  denied.searchParams.set('branch_id', randomUUID());
  await pos.goto(denied.toString());
  await pos.getByText('Your POS account cannot access this branch.', { exact: true }).waitFor();
  await fs.writeFile(
    '../verification/pos-navigation.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Separate POS login resumes exact product and pricing tab',
          'Requested authorized branch becomes active',
          'Stock link opens variants tab',
          'Expired POS session preserves destination after login',
          'Unauthorized branch stays blocked',
          'Handoff contains no credentials',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS POS handoff, branch context, tabs, expired login and denied branch');
} catch (error) {
  if (pos) console.error(await pos.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
