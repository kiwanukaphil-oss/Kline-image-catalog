import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { configureTestEnvironment } from '../../server/tests/environment.cjs';
const { source } = configureTestEnvironment(),
  { pool } = source('config/database');
const name = 'Mapping check ' + Date.now(),
  categoryId = randomUUID();
await pool.query('INSERT INTO inventory.categories(id,slug,name) VALUES($1,$3,$2)', [
  categoryId,
  name,
  categoryId,
]);
await pool.query(
  `INSERT INTO inventory.items(id,name,category_id,branch_id,image_path)
  SELECT gen_random_uuid(),$1,$2,branch_id,image_path FROM inventory.items WHERE image_path IS NOT NULL LIMIT 1`,
  [name, categoryId],
);
const target = (await pool.query('SELECT id,name FROM categories WHERE is_active=true ORDER BY name LIMIT 1'))
  .rows[0];
await pool.end();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
try {
  // Exercise the blocked-item entry point, persisted global mapping and compact mobile layout against POS.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('tab', { name: 'All merchandise', exact: true }).click();
  await page.getByLabel('Find incoming merchandise').fill(name);
  await page.locator('.receiving-identity').filter({ hasText: name }).click();
  await page.getByRole('button', { name: 'Connect POS category', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Category mappings', exact: true });
  await dialog.getByRole('button', { name: new RegExp(name) }).click();
  await dialog.getByLabel('POS category', { exact: true }).selectOption(target.id);
  await page.screenshot({ path: '../verification/category-mappings-desktop.png' });
  await dialog.getByRole('button', { name: 'Save mapping', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Connect POS category', exact: true }).waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Category mappings', exact: true }).click();
  await dialog.getByPlaceholder('Find catalog category').fill(name);
  await dialog.getByRole('button', { name: new RegExp(name) }).waitFor();
  assert.ok((await dialog.innerText()).includes(target.name));
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: '../verification/category-mappings-mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await fs.writeFile(
    '../verification/category-mappings.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Blocked item opens category connection',
          'Saving clears mapping blocker',
          'Global mapping persists',
          '360px layout fits',
        ],
        package: '0.9.0',
      },
      null,
      2,
    ),
  );
  console.log('PASS category mapping receiving entry, save, persistence and mobile');
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
