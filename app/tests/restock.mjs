import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { configureTestEnvironment } from '../../server/tests/environment.cjs';
const { source } = configureTestEnvironment(),
  { pool } = source('config/database');
const name = 'Restock browser ' + Date.now(),
  categoryId = randomUUID(),
  itemId = randomUUID(),
  lineId = randomUUID();
const branch = '00000000-0000-4000-b111-000000000001';
const variant = (
  await pool.query(
    `SELECT v.*,p.name AS product_name,p.category_id FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.sku='TSH-S-BLU'`,
  )
).rows[0];
await pool.query("UPDATE products SET status='published' WHERE id=$1", [variant.product_id]);
await pool.query('INSERT INTO inventory.categories(id,slug,name) VALUES($1,$2,$2)', [categoryId, name]);
await pool.query(
  'INSERT INTO inventory.pos_category_map(id,image_category_id,pos_category_id,created_at,updated_at) VALUES($1,$2,$3,now(),now())',
  [randomUUID(), categoryId, variant.category_id],
);
await pool.query(
  `INSERT INTO inventory.items(id,name,category_id,branch_id,image_path,price,stock_quantity,stock_distribution_source)
 SELECT $1,$2,$3,$4,image_path,100000,3,'human_confirmed' FROM inventory.items WHERE image_path IS NOT NULL LIMIT 1`,
  [itemId, name, categoryId, branch],
);
await pool.query('INSERT INTO inventory.item_costs(item_id,cost_price) VALUES($1,42000)', [itemId]);
await pool.query(
  `INSERT INTO inventory.item_variant_lines(id,item_id,position,variant_key,variant_attributes,quantity) VALUES($1,$2,0,'size-s','{"size":"S"}',3)`,
  [lineId, itemId],
);
const before = Number(
  (
    await pool.query('SELECT stock_quantity FROM branch_inventory WHERE branch_id=$1 AND variant_id=$2', [
      branch,
      variant.id,
    ])
  ).rows[0]?.stock_quantity || 0,
);
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
try {
  // Receive through the real matching UI, then verify the exact existing variant and immutable POS prices in PostgreSQL.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('tab', { name: 'All merchandise', exact: true }).click();
  await page.getByLabel('Find incoming merchandise').fill(name);
  await page.locator('.receiving-identity').filter({ hasText: name }).click();
  await page.getByRole('button', { name: 'Restock existing product', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Restock existing product', exact: true });
  await dialog.getByPlaceholder('Find POS product, SKU or barcode').fill('TSH-S-BLU');
  await dialog.getByRole('button', { name: new RegExp(variant.product_name) }).click();
  await dialog.getByLabel('POS variant for S', { exact: true }).selectOption(variant.id);
  await dialog.getByRole('button', { name: 'Review restock', exact: true }).click();
  await dialog.getByText('POS selling prices and costs stay unchanged.').waitFor();
  await page.screenshot({ path: '../verification/restock-desktop.png' });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: '../verification/restock-mobile.png' });
  await dialog.getByRole('button', { name: 'Confirm restock', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const after = (await pool.query('SELECT * FROM product_variants WHERE id=$1', [variant.id])).rows[0];
  assert.equal(after.price, variant.price);
  assert.equal(after.cost_price, variant.cost_price);
  assert.equal(
    Number(
      (
        await pool.query('SELECT stock_quantity FROM branch_inventory WHERE branch_id=$1 AND variant_id=$2', [
          branch,
          variant.id,
        ])
      ).rows[0].stock_quantity,
    ),
    before + 3,
  );
  assert.equal(
    (await pool.query('SELECT product_id FROM inventory.catalog_publications WHERE item_id=$1', [itemId]))
      .rows[0].product_id,
    variant.product_id,
  );
  await fs.writeFile(
    '../verification/restock.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Explicit product and variant selection',
          'Incoming and retained POS prices reviewed',
          'Desktop/mobile confirmation',
          'Three units added to chosen existing variant',
          'POS price and cost unchanged',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS explicit existing-product restock and retained prices/costs');
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
  await pool.end();
}
