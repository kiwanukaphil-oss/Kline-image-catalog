import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { configureTestEnvironment } from '../../server/tests/environment.cjs';
const dependencies = configureTestEnvironment(),
  { pool } = dependencies.source('config/database');
const existing = (
  await pool.query(`SELECT b.id,b.title FROM catalog_workspace.batches b
  JOIN catalog_workspace.batch_items bi ON bi.batch_id=b.id WHERE b.title LIKE 'Load %'
  GROUP BY b.id HAVING count(*)=1000 ORDER BY b.created_at DESC LIMIT 1`)
).rows[0];
const category = randomUUID(),
  batch = existing?.id || randomUUID(),
  prefix = existing?.title || 'Load ' + Date.now();
const branch = '00000000-0000-4000-b111-000000000001';
const started = performance.now();
// Seed actual PostgreSQL preparation data; no stock is received and no selling prices are applied.
if (!existing) {
  await pool.query("INSERT INTO inventory.categories(id,slug,name) VALUES($1,$2,'Benchmark formal shirts')", [
    category,
    category,
  ]);
  await pool.query(
    `INSERT INTO catalog_workspace.batches(id,title,branch_id,created_by)
  VALUES($1,$2,$3,(SELECT id FROM users WHERE username='testadmin'))`,
    [batch, prefix, branch],
  );
  await pool.query(
    `WITH lots AS (INSERT INTO inventory.items(id,category_id,branch_id,name,brand,image_path,stock_quantity,stock_distribution_source)
  SELECT gen_random_uuid(),$1,$2,$3||' shirt '||n,'Hugo Boss',
    (SELECT image_path FROM inventory.items WHERE image_path IS NOT NULL LIMIT 1),3,'human_confirmed'
  FROM generate_series(1,1000)n RETURNING id),
  members AS (INSERT INTO catalog_workspace.batch_items(item_id,batch_id,added_by)
    SELECT id,$4,(SELECT id FROM users WHERE username='testadmin') FROM lots)
  INSERT INTO inventory.item_variant_lines(id,item_id,position,variant_key,variant_attributes,quantity)
    SELECT gen_random_uuid(),id,ordinality-1,md5(jsonb_build_object('size',size)::text),jsonb_build_object('size',size),1
    FROM lots CROSS JOIN unnest(ARRAY['M','L','XL']) WITH ORDINALITY AS sizes(size,ordinality)`,
    [category, branch, prefix, batch],
  );
}
const seedMs = performance.now() - started;
await pool.end();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
page.setDefaultTimeout(60000);
const requests = [],
  errors = [];
page.on('request', (request) => {
  if (request.url().includes('/api/')) requests.push({ url: request.url(), method: request.method() });
});
page.on('pageerror', (error) => errors.push(error.message));
const metrics = { seed_ms: Math.round(seedMs) };
try {
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Search deliveries', { exact: true }).fill(prefix);
  const receivingStart = performance.now();
  await page.locator('.delivery-card').filter({ hasText: prefix }).click();
  await page.getByText('1–48 of 1000', { exact: true }).waitFor();
  metrics.receiving_first_page_ms = Math.round(performance.now() - receivingStart);
  const pricingStart = performance.now(),
    requestStart = requests.length;
  await page.getByRole('button', { name: 'Pricing', exact: true }).click();
  await page.getByLabel('Find merchandise', { exact: true }).fill(prefix);
  await page.getByRole('button', { name: 'Select all 1000 matches', exact: true }).waitFor();
  metrics.pricing_complete_load_ms = Math.round(performance.now() - pricingStart);
  metrics.pricing_workspace_requests = requests
    .slice(requestStart)
    .filter((row) => row.url.includes('/pricing/workspace')).length;
  const selectionStart = performance.now();
  await page.getByRole('button', { name: 'Select all 1000 matches', exact: true }).click();
  await page.getByText('3000 sizes · 3000 units selected', { exact: true }).waitFor();
  metrics.select_all_ms = Math.round(performance.now() - selectionStart);
  await page.getByLabel('Shared price', { exact: true }).fill('100000');
  const reviewStart = performance.now();
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/catalog/pricing/preview'),
  );
  await page.getByRole('button', { name: 'Review prices', exact: true }).click();
  const response = await responsePromise,
    result = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(result));
  assert.equal(result.data.summary.item_count, 1000);
  assert.equal(result.data.rows.length, 3000);
  await page.getByRole('dialog', { name: 'Review prices', exact: true }).waitFor();
  metrics.review_1000_lots_ms = Math.round(performance.now() - reviewStart);
  await page.screenshot({ path: '../verification/large-delivery-review.png' });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    '../verification/large-delivery.json',
    JSON.stringify(
      {
        passed: true,
        lots: 1000,
        size_lines: 3000,
        metrics,
        total_api_requests: requests.length,
        environment:
          'Local development build, real POS and PostgreSQL, reused real photo object; network and unique-photo staging load remain separate',
        prices_applied: false,
      },
      null,
      2,
    ),
  );
  console.log('PASS 1000-lot / 3000-size browser and PostgreSQL workload', JSON.stringify(metrics));
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
