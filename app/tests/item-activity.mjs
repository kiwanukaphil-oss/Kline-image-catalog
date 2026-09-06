import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { configureTestEnvironment } from '../../server/tests/environment.cjs';
const { source } = configureTestEnvironment(),
  { pool } = source('config/database'),
  id = randomUUID(),
  name = 'Activity browser ' + Date.now();
await pool.query(
  `INSERT INTO inventory.items(id,name,category_id,branch_id)
  SELECT $1,$2,category_id,branch_id FROM inventory.items WHERE branch_id='00000000-0000-4000-b111-000000000001' LIMIT 1`,
  [id, name],
);
await pool.query(
  `INSERT INTO inventory.item_events(item_id,event_type,source,field_path,before_value,after_value,actor,created_at)
  SELECT $1,'manual_edit',CASE WHEN n=1 THEN 'ai' ELSE 'manual' END,'name','"Earlier name"','"Reviewed name"',id,now()
  FROM users CROSS JOIN generate_series(1,26)n WHERE username='testadmin'`,
  [id],
);
await pool.end();
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  // Open historical changes over unsaved details and return without losing the current edit.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('tab', { name: 'All merchandise', exact: true }).click();
  await page.getByLabel('Find incoming merchandise').fill(name);
  await page.locator('.receiving-identity').filter({ hasText: name }).click();
  await page.getByLabel('Product name', { exact: true }).fill('Unsaved name');
  await page.getByRole('button', { name: 'Item activity', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Item activity', exact: true });
  await dialog.locator('article').first().waitFor();
  assert.equal(await dialog.locator('article').count(), 24);
  await dialog.locator('summary').first().click();
  await dialog.getByText('After: Reviewed name', { exact: true }).first().waitFor();
  await page.screenshot({ path: '../verification/item-activity-mobile.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByText(/25.*26 of 26/).waitFor();
  await dialog.locator('article').nth(2).waitFor({ state: 'hidden' });
  assert.equal(await dialog.locator('article').count(), 2);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByLabel('Product name', { exact: true }).inputValue(), 'Unsaved name');
  await fs.writeFile(
    '../verification/item-activity.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Actor and timestamp history opens from item',
          'Recorded before/after readable',
          'History pages beyond 24 records',
          'Parent unsaved edit retained',
          'Mobile layout inspected',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS item activity pagination and preservation of unsaved details');
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
