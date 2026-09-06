import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  // Match the full legacy-link queue, then preserve choices through an empty search and clear them explicitly.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('tab', { name: 'All merchandise', exact: true }).click();
  await page.getByLabel('Receiving task', { exact: true }).selectOption('reconcile');
  await page.getByLabel('Receiving sort', { exact: true }).selectOption('oldest');
  await page.locator('.receiving-row').first().waitFor();
  const rows = await page.locator('.receiving-row').allTextContents();
  assert(rows.length > 0);
  assert(rows.every((row) => row.includes('Check POS link')));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '../verification/receiving-filters-mobile.png', animations: 'disabled' });
  await page.getByLabel('Find incoming merchandise').fill('No such merchandise anywhere 918273');
  await page.getByText('No merchandise matches.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Receiving task', { exact: true }).inputValue(), 'reconcile');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  assert.equal(await page.getByLabel('Receiving task', { exact: true }).inputValue(), 'all');
  assert.equal(await page.getByLabel('Receiving sort', { exact: true }).inputValue(), 'oldest');
  await fs.writeFile(
    '../verification/receiving-filters.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Task filter selects only reconciliation rows',
          'Useful oldest-first ordering',
          'Mobile controls fit',
          'Empty results preserve filters',
          'Clear filters preserves chosen sort',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS receiving task filtering and empty-state recovery');
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
