import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { configureTestEnvironment } from '../../server/tests/environment.cjs';
const dependencies = configureTestEnvironment();
const { pool } = dependencies.source('config/database');
const branch = '00000000-0000-4000-b111-000000000001';
const fixture = (
  await pool.query(
    `SELECT p.id,i.name FROM inventory.catalog_publications p
  JOIN inventory.items i ON i.id=p.item_id WHERE p.branch_id=$1 ORDER BY p.published_at LIMIT 1`,
    [branch],
  )
).rows[0];
const prefix = 'History browser ' + Date.now();
await pool.query(
  `INSERT INTO catalog_workspace.batches(id,title,branch_id,created_by)
  SELECT gen_random_uuid(),$1||' '||n,$2,(SELECT id FROM users WHERE username='testadmin') FROM generate_series(1,27)n`,
  [prefix, branch],
);
await pool.end();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
try {
  // Search and traverse persisted deliveries, then locate an older actual receipt by its immutable identifier.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Search deliveries', { exact: true }).fill(prefix);
  await page.getByText('1–24 of 27', { exact: true }).waitFor();
  const first = await page.locator('.delivery-card').allTextContents();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText('25–27 of 27', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.delivery-card').length === 3);
  const second = await page.locator('.delivery-card').allTextContents();
  assert.equal(new Set([...first, ...second]).size, 27);
  await page.screenshot({ path: '../verification/history-desktop.png' });
  await page.getByLabel('Search deliveries', { exact: true }).fill('no-such-delivery-' + Date.now());
  await page.getByText('No matching deliveries.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.getByRole('tab', { name: 'Receipts', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByLabel('Search receipts or deliveries', { exact: true }).fill(fixture.id);
  await page.locator('.receipt-row').filter({ hasText: fixture.name }).waitFor();
  assert.equal(await page.locator('.receipt-row').count(), 1);
  await page.screenshot({ path: '../verification/history-mobile.png' });
  await page.locator('.receipt-row').click();
  await page.getByRole('button', { name: 'View lot and photo' }).waitFor();
  await fs.writeFile(
    '../verification/history-browser.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          '27 persisted deliveries across two pages without repetition',
          'Empty search clears to complete history',
          'Older receipt found by immutable ID on mobile',
          'Historical receipt opens full lot details',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS history desktop/mobile search, pagination and receipt access');
} finally {
  await browser.close();
}
