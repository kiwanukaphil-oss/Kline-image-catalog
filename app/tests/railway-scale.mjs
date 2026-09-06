import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const requirePos = createRequire('C:/Projects/Inventory POS release check/backend/package.json');
const { Pool } = requirePos('pg');
const configuration = JSON.parse(
  (await fs.readFile('../.test-data/railway-staging-private.json', 'utf8')).replace(/^\uFEFF/, ''),
);
assert.equal(configuration.database.RAILWAY_PROJECT_ID, '9ce0cab6-9ab1-4da3-854b-afcf4cfa914b');
const proxy = JSON.parse(
  (await fs.readFile('../.test-data/staging-scale-proxy.json', 'utf8')).replace(/^\uFEFF/, ''),
).proxy;
const pool = new Pool({
  host: proxy.domain,
  port: proxy.proxyPort,
  user: configuration.database.PGUSER,
  password: configuration.database.PGPASSWORD,
  database: configuration.database.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});
const branch = 'a1c58076-0210-4582-ba91-6da346ea602e';
const shorts = process.env.KLINE_SCALE_SCENARIO === 'shorts';
const prefix = shorts ? 'Shorts scale acceptance' : 'Synthetic scale acceptance';
const evidence = shorts ? 'shorts-scale' : 'large-delivery';
const expectedPrice = (row) =>
  shorts ? (row.brand === 'H&M' ? 80000 : 60000) : row.variant_attributes.size === 'XL' ? 150000 : 100000;
const started = performance.now();
let batch;
try {
  // Seed only synthetic, unreceived preparation records in the explicitly guarded staging project.
  const existing = (
    await pool.query('SELECT id FROM catalog_workspace.batches WHERE title=$1 AND branch_id=$2', [
      prefix,
      branch,
    ])
  ).rows[0];
  batch = existing?.id || randomUUID();
  if (!existing) {
    const category = (
      await pool.query('SELECT id FROM inventory.categories WHERE name=$1', [
        shorts ? 'Shorts' : 'Formal shirts',
      ])
    ).rows[0].id;
    const actor = (await pool.query("SELECT id FROM users WHERE username='staging-admin'")).rows[0].id;
    await pool.query('BEGIN');
    await pool.query(
      'INSERT INTO catalog_workspace.batches(id,title,branch_id,created_by) VALUES($1,$2,$3,$4)',
      [batch, prefix, branch, actor],
    );
    await pool.query(
      `WITH lots AS (INSERT INTO inventory.items(id,category_id,branch_id,name,brand,image_path,stock_quantity,stock_distribution_source)
      SELECT gen_random_uuid(),$1,$2,$3||' lot '||n,
        CASE WHEN $6::boolean AND n % 2=0 THEN 'H&M' WHEN $6::boolean THEN 'Other brand' ELSE 'Hugo Boss' END,
        (SELECT image_path FROM inventory.items WHERE image_path IS NOT NULL LIMIT 1),3,'human_confirmed'
      FROM generate_series(1,1000)n RETURNING id),
      members AS (INSERT INTO catalog_workspace.batch_items(item_id,batch_id,added_by) SELECT id,$4,$5 FROM lots)
      INSERT INTO inventory.item_variant_lines(id,item_id,position,variant_key,variant_attributes,quantity)
        SELECT gen_random_uuid(),id,ordinality-1,md5(jsonb_build_object('size',size)::text),jsonb_build_object('size',size),1
        FROM lots CROSS JOIN unnest(ARRAY['M','L','XL']) WITH ORDINALITY AS sizes(size,ordinality)`,
      [category, branch, prefix, batch, actor, shorts],
    );
    await pool.query('COMMIT');
  }
} catch (error) {
  await pool.query('ROLLBACK');
  throw error;
} finally {
  await pool.end();
}
const seedMs = performance.now() - started;
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
  await page.goto('https://catalog-web-production-2d56.up.railway.app');
  await page.getByLabel('Username').fill(configuration.account.username);
  await page.getByLabel('Password', { exact: true }).fill(configuration.account.password);
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
  await page.getByLabel('Shared price', { exact: true }).fill(shorts ? '60000' : '100000');
  await page.getByRole('button', { name: 'Add exception', exact: true }).click();
  await page
    .getByRole('combobox', { name: shorts ? 'Brand for exception 1' : 'Size for exception 1', exact: true })
    .click();
  await page.getByRole('option', { name: shorts ? 'H&M' : 'XL', exact: true }).click();
  await page.getByLabel('Price for exception 1', { exact: true }).fill(shorts ? '80000' : '150000');
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
  assert(result.data.rows.every((row) => row.price_after === expectedPrice(row)));
  await page.getByRole('dialog', { name: 'Review prices', exact: true }).waitFor();
  metrics.review_1000_lots_ms = Math.round(performance.now() - reviewStart);
  await page.screenshot({ path: `../verification/railway/${evidence}-review.png` });
  const verifyPrices = new Pool(pool.options);
  try {
    // Check actual saved values, then restore the unpriced fixture through the normal audited UI.
    await page.getByRole('dialog').getByRole('button', { name: 'Save prices', exact: true }).click();
    await page.getByRole('heading', { name: 'Prices saved', exact: true }).waitFor();
    const saved = (
      await verifyPrices.query(
        `SELECT count(*) AS lines,
      count(*) FILTER (WHERE coalesce(l.price_override,i.price) IS DISTINCT FROM
        CASE WHEN $2::boolean THEN CASE WHEN i.brand='H&M' THEN 80000 ELSE 60000 END
        ELSE CASE WHEN l.variant_attributes->>'size'='XL' THEN 150000 ELSE 100000 END END) AS wrong
      FROM inventory.item_variant_lines l JOIN inventory.items i ON i.id=l.item_id
      JOIN catalog_workspace.batch_items bi ON bi.item_id=i.id WHERE bi.batch_id=$1`,
        [batch, shorts],
      )
    ).rows[0];
    assert.equal(Number(saved.lines), 3000);
    assert.equal(Number(saved.wrong), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Undo these prices', exact: true }).click();
    await page.getByRole('heading', { name: 'Prices restored', exact: true }).waitFor();
    const restored = (
      await verifyPrices.query(
        `SELECT count(*) AS priced
      FROM inventory.item_variant_lines l JOIN inventory.items i ON i.id=l.item_id
      JOIN catalog_workspace.batch_items bi ON bi.item_id=i.id
      WHERE bi.batch_id=$1 AND coalesce(l.price_override,i.price) IS NOT NULL`,
        [batch],
      )
    ).rows[0];
    assert.equal(Number(restored.priced), 0);
    await page.screenshot({ path: `../verification/railway/${evidence}-undo-mobile.png` });
  } finally {
    await verifyPrices.end();
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `../verification/railway/${evidence}.json`,
    JSON.stringify(
      {
        passed: true,
        checked_at: new Date().toISOString(),
        scenario: shorts ? 'All shorts 60,000; H&M 80,000' : 'Hugo Boss formal shirts 100,000; XL 150,000',
        lots: 1000,
        size_lines: 3000,
        metrics,
        total_api_requests: requests.length,
        environment:
          'Railway HTTPS and PostgreSQL; 1000 synthetic lots sharing an existing photo object. Not a unique-photo upload or concurrent-user throughput test.',
        prices_applied: true,
        prices_restored: true,
        exact_exception_verified: true,
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
