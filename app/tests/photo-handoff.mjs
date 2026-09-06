import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { configureTestEnvironment } from '../../server/tests/environment.cjs';
import { installLocalImageStore } from '../../server/tests/local-images.cjs';
import { createLocalHost } from '../../server/local-host.cjs';

const dependencies = configureTestEnvironment();
installLocalImageStore(dependencies);
const { pool } = dependencies.source('config/database');
const storage = dependencies.source('services/railwayObjectStorageService');
const fixture = (
  await pool.query(`SELECT i.id,i.name,h.source_key,h.product_id FROM inventory.items i
  JOIN inventory.catalog_photo_handoffs h ON h.item_id=i.id
  JOIN inventory.catalog_publications p ON p.item_id=i.id
  WHERE h.status IN ('pending','failed') ORDER BY p.published_at DESC LIMIT 1`)
).rows[0];
assert(fixture, 'A received lot awaiting its photo is required.');
const imageBytes = await fs.readFile(path.resolve('../.test-data/images', fixture.source_key));
const copies = new Map();
let available = false;
// Substitute only private bucket I/O, retaining real original bytes and all POS HTTP/database behavior.
storage.inspectPrivateObject = async (key) => {
  if (!available) throw new Error('Fixture bucket unavailable');
  const object = key === fixture.source_key ? { buffer: imageBytes, metadata: {} } : copies.get(key);
  if (!object) throw new Error('Missing object');
  return { contentLength: object.buffer.length, contentType: 'image/jpeg', metadata: object.metadata };
};
storage.downloadPrivateObject = async () => ({ buffer: imageBytes });
storage.storePrivateObjectIfAbsent = async (object) => {
  copies.set(object.objectKey, object);
};
const server = createLocalHost(dependencies).listen(0, '127.0.0.1');
await new Promise((resolve) => server.on('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  // Navigate through the actual receipt, retry once during an outage, then recover on mobile.
  await page.route('http://127.0.0.1:5109/api/**', (route) =>
    route.continue({ url: route.request().url().replace('http://127.0.0.1:5109/api', base) }),
  );
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('tab', { name: 'Receipts', exact: true }).click();
  await page.locator('.receipt-row').filter({ hasText: fixture.name }).first().click();
  await page.getByRole('button', { name: 'View lot and photo' }).click();
  await page.getByRole('button', { name: 'Retry photo transfer' }).click();
  await page.getByRole('button', { name: 'Retry photo transfer' }).waitFor();
  await page.screenshot({ path: '../verification/photo-handoff-desktop.png' });
  await page.setViewportSize({ width: 360, height: 800 });
  available = true;
  await page.getByRole('button', { name: 'Retry photo transfer' }).click();
  await page.getByText('Photo available in POS', { exact: true }).waitFor();
  await page.screenshot({ path: '../verification/photo-handoff-mobile.png' });
  const product = (await pool.query('SELECT image_path FROM products WHERE id=$1', [fixture.product_id]))
    .rows[0];
  assert.deepEqual(copies.get(product.image_path).buffer, imageBytes);
  assert.equal(await page.getByRole('button', { name: 'Retry photo transfer' }).count(), 0);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    '../verification/photo-handoff-browser.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Receipt opens original lot and image status',
          'Failed transfer remains retryable',
          'Mobile retry attaches exact original bytes to POS',
          'Successful transfer removes retry action',
        ],
        storage: 'Local byte-preserving bucket fixture; live private bucket acceptance pending',
      },
      null,
      2,
    ),
  );
  console.log('PASS photo handoff desktop/mobile, outage recovery and original bytes');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
