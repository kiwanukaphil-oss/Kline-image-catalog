import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
const checks = [];

/** Verify recovery is discoverable after reload and keyboard focus remains inside an open detail dialog. */
try {
  await page.goto(process.env.KLINE_PREVIEW_URL || 'http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Receiving', exact: true }).waitFor();
  await page.getByRole('button', { name: 'New delivery', exact: true }).first().click();
  await page.getByLabel('Delivery name').fill('Upload recovery check');
  await page.getByLabel('Delivery photos').setInputFiles(path.join(root, 'design/assets/item-0.jpg'));
  await page.route('**/api/catalog/items', (route) =>
    route.request().method() === 'POST' ? route.abort('connectionreset') : route.continue(),
  );
  await page.getByRole('button', { name: 'Add to Receiving' }).click();
  await page.getByRole('button', { name: 'Resume uploads', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Receiving', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Resume 1 uploads', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
  await page.getByLabel('Username').fill('testcashier');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Receiving', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Resume 1 uploads', exact: true }).count(), 0);
  checks.push('Pending images are isolated by account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Resume 1 uploads', exact: true }).click();
  await page.unroute('**/api/catalog/items');
  await page.getByRole('button', { name: 'Resume uploads', exact: true }).click();
  await page.getByRole('heading', { name: 'Upload recovery check', exact: true }).waitFor();
  await page.locator('.receiving-row').first().waitFor();
  assert.equal(await page.locator('.receiving-row').count(), 1);
  checks.push('Receiving exposes unfinished uploads and resumes the same lot after reopening');
  await page.getByRole('button', { name: 'Stock', exact: true }).click();
  await page.locator('.stock-card').first().waitFor();
  const card = page.locator('.stock-card').first();
  await card.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="dialog"]'));
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => !!document.activeElement?.closest('[role="dialog"]'));
  }
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert(await card.evaluate((element) => element === document.activeElement));
  checks.push('Keyboard activation, modal focus trap, Escape and focus restoration work');
  await fs.writeFile(
    path.join(root, 'verification/recovery-keyboard.json'),
    JSON.stringify({ passed: true, checked_at: new Date().toISOString(), checks }, null, 2),
  );
  console.log(checks.map((check) => 'PASS ' + check).join('\n'));
} finally {
  await browser.close();
}
