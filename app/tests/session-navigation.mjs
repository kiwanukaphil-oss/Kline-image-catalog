import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
try {
  // Expire the actual next save at the HTTP boundary, then resume the same account without remounting its draft.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('tab', { name: 'All merchandise', exact: true }).click();
  await page.getByLabel('Find incoming merchandise').fill('Cancellation browser');
  await page.locator('.receiving-identity').first().click();
  await page.getByLabel('Product name', { exact: true }).fill('Unsaved after expiry');
  await page.route('**/api/catalog-workspace/items/*', async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Session expired' }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  const login = page.getByRole('dialog', { name: 'Sign in to continue', exact: true });
  await login.waitFor();
  assert.equal(await login.getByLabel('Username').inputValue(), 'testadmin');
  assert.equal(await login.getByLabel('Username').getAttribute('readonly'), '');
  await login.getByLabel('Password', { exact: true }).fill('testpass123');
  await login.getByRole('button', { name: 'Sign in', exact: true }).click();
  await login.waitFor({ state: 'hidden' });
  assert.equal(await page.getByLabel('Product name', { exact: true }).inputValue(), 'Unsaved after expiry');
  await page.screenshot({ path: '../verification/session-recovery.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Discard/ }).click();
  await page.getByRole('button', { name: 'Pricing', exact: true }).click();
  await page.getByLabel('Shared price').fill('100000');
  const originalBranch = await page.getByLabel('Active branch').inputValue();
  const otherBranch = await page
    .getByLabel('Active branch')
    .locator('option')
    .evaluateAll((options) => options.map((option) => option.value));
  await page.getByLabel('Active branch').selectOption(otherBranch.find((id) => id !== originalBranch));
  const guard = page.getByRole('dialog', { name: 'Leave unsaved work?', exact: true });
  await guard.waitFor();
  await guard.getByRole('button', { name: 'Keep working', exact: true }).click();
  assert.equal(await page.getByLabel('Active branch').inputValue(), originalBranch);
  assert.equal(await page.getByLabel('Shared price').inputValue(), '100000');
  await page.getByRole('button', { name: 'Stock', exact: true }).click();
  await guard.getByRole('button', { name: 'Discard and leave', exact: true }).click();
  await page.getByRole('heading', { name: /Stock/ }).first().waitFor();
  await fs.writeFile(
    '../verification/session-navigation.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          '401 preserves unsaved item input',
          'Same-account reauthentication retains active branch',
          'Pricing branch change requires explicit discard',
          'Keep working retains price and branch',
          'Discard completes workspace navigation',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS session recovery and unsaved navigation protection');
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
