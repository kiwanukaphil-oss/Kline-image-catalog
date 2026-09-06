import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { configureTestEnvironment } from '../../server/tests/environment.cjs';
const { source } = configureTestEnvironment(),
  { pool } = source('config/database');
const name = 'Older POS link ' + Date.now(),
  categoryId = randomUUID();
await pool.query('INSERT INTO inventory.categories(id,slug,name) VALUES($1,$2,$2)', [categoryId, name]);
await pool.query(
  `INSERT INTO inventory.items(id,name,category_id,branch_id,pos_product_id,pos_sync_status)
  SELECT gen_random_uuid(),$1,$2,'00000000-0000-4000-b111-000000000001',id,'pending' FROM products ORDER BY id LIMIT 1`,
  [name, categoryId],
);
await pool.end();
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage({ viewport: { width: 360, height: 800 } });
try {
  // Older incomplete links are visible and read-only, without pretending a fresh receipt or delivery exists.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('tab', { name: 'All merchandise', exact: true }).click();
  await page.getByLabel('Find incoming merchandise').fill(name);
  await page.getByRole('button', { name: 'Check POS link', exact: true }).waitFor();
  await page.locator('.receiving-identity').filter({ hasText: name }).click();
  await page.getByText('Existing POS link · receiving locked', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save details', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Restock existing product', exact: true }).count(), 0);
  await page.screenshot({ path: '../verification/older-data-mobile.png', animations: 'disabled' });
  await fs.writeFile(
    '../verification/older-data.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Older incomplete POS link appears in receiving',
          'Explicit check-link status',
          'Read-only details and no restock action',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS older linked stock remains visible and protected');
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
