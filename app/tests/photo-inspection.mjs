import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { configureTestEnvironment } from '../../server/tests/environment.cjs';
const dependencies = configureTestEnvironment(),
  { pool } = dependencies.source('config/database');
const name = 'Photo inspection ' + Date.now();
await pool.query(
  `INSERT INTO inventory.items(id,name,category_id,branch_id,image_path,attributes)
  SELECT gen_random_uuid(),$1,category_id,branch_id,image_path,attributes FROM inventory.items
  WHERE image_path IS NOT NULL AND pos_product_id IS NULL ORDER BY created_at DESC LIMIT 1`,
  [name],
);
await pool.end();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
try {
  // Inspect fresh URLs in a nested dialog while retaining the unsaved parent form and its focus.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('tab', { name: 'All merchandise', exact: true }).click();
  await page.getByLabel('Find incoming merchandise').fill(name);
  await page.locator('.receiving-identity').filter({ hasText: name }).click();
  await page.getByLabel('Product name', { exact: true }).fill(name + ' edited');
  await page.route('**/test-images?**', (route) => route.abort());
  await page.getByRole('button', { name: 'Inspect photo', exact: true }).click();
  const inspector = page.getByRole('dialog', { name: 'Inspect photo', exact: true });
  await inspector.getByText('Photo unavailable', { exact: true }).waitFor();
  await page.unroute('**/test-images?**');
  await inspector.getByRole('button', { name: 'Reload photo', exact: true }).click();
  await inspector.locator('img').waitFor();
  await inspector.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await inspector.getByText('2×', { exact: true }).waitFor();
  await page.screenshot({ path: '../verification/photo-inspection-desktop.png' });
  await page.setViewportSize({ width: 360, height: 800 });
  await inspector.getByRole('button', { name: 'Fit photo', exact: true }).click();
  await page.screenshot({ path: '../verification/photo-inspection-mobile.png' });
  await page.keyboard.press('Escape');
  assert.equal(await page.getByLabel('Product name', { exact: true }).inputValue(), name + ' edited');
  await page.getByRole('checkbox', { name: 'Hold for photo or label check' }).check();
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await page.getByRole('checkbox', { name: "I have resolved this item's problem flag" }).waitFor();
  await fs.writeFile(
    '../verification/photo-inspection-browser.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Fresh photo reload after an unavailable image',
          'Desktop zoom and mobile fit',
          'Escape closes viewer while preserving unsaved draft',
          'Saved photo hold requires explicit resolution',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS photo inspection, reload, zoom, unsaved form and photo hold');
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
