import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const itemId = 'a0000000-0000-4000-8000-000000000001';
const categoryId = 'a0000000-0000-4000-8000-000000000002';
const item = {
  id: itemId,
  category_id: categoryId,
  name: 'Imported legacy shirt',
  brand: 'Hugo Boss',
  image_url: null,
  attributes: { fit: 'Legacy fit' },
  variant_lines: [],
  stock_quantity: 1,
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  is_published: false,
  status: 'needs-review',
  stock_distribution_source: 'intake_default',
  blockers: ['Confirm sizes'],
  batch_id: null,
  batch_title: null,
  price: null,
};
const fields = [
  {
    category_id: categoryId,
    key: 'fit',
    label: 'Fit',
    type: 'select',
    options: ['Regular', 'Slim'],
    required: false,
    inherit: false,
    sort: 0,
  },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
let savedPayload;
try {
  // Model a pre-delivery catalog at the HTTP boundary; no production records are written.
  await page.route('**/catalog/reference-data', (route) =>
    route.fulfill({
      json: {
        data: {
          categories: [{ id: categoryId, name: 'Shirts', parent_id: null }],
          fields,
        },
      },
    }),
  );
  await page.route('**/catalog-workspace/history/deliveries?*', (route) =>
    route.fulfill({ json: { items: [], total: 0, limit: 24 } }),
  );
  await page.route('**/catalog-workspace/history/receipts?*', (route) =>
    route.fulfill({ json: { items: [], total: 0, limit: 24 } }),
  );
  await page.route('**/catalog-workspace/items?*', (route) =>
    route.fulfill({ json: { items: [item], total: 1, page: 1, limit: 24 } }),
  );
  await page.route(`**/catalog-workspace/items/${itemId}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      savedPayload = route.request().postDataJSON();
      item.name = savedPayload.name;
      return route.fulfill({ json: { item } });
    }
    return route.fulfill({ json: { item, fields, revision: 'fixture-revision', blockers: item.blockers } });
  });
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.receiving-identity').filter({ hasText: item.name }).waitFor();
  assert.equal(
    await page.getByRole('tab', { name: 'All merchandise', exact: true }).getAttribute('aria-selected'),
    'true',
  );
  await page.getByRole('tab', { name: 'Deliveries', exact: true }).click();
  await page.getByRole('heading', { name: 'Your next delivery starts here.' }).waitFor();
  assert.equal(
    await page.getByRole('tab', { name: 'Deliveries', exact: true }).getAttribute('aria-selected'),
    'true',
  );
  await page.getByRole('tab', { name: 'All merchandise', exact: true }).click();
  await page.locator('.receiving-identity').filter({ hasText: item.name }).click();
  await page.getByLabel('Fit', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Fit', { exact: true }).inputValue(), 'Legacy fit');
  assert.equal(
    await page.getByLabel('Fit', { exact: true }).locator('option:checked').innerText(),
    'Legacy fit (saved)',
  );
  await page.getByLabel('Product name', { exact: true }).fill('Corrected legacy shirt');
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await page.getByText('Details saved', { exact: true }).waitFor();
  assert.equal(savedPayload.name, 'Corrected legacy shirt');
  assert.deepEqual(savedPayload.attributes, {});
  await fs.writeFile(
    '../verification/migration-interface.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Existing merchandise opens without invented delivery groups',
          'Explicit tab choices are retained',
          'Historical select value remains visible',
          'Name-only edits do not rewrite historical attributes',
        ],
        scope: 'Frontend HTTP-boundary fixture with real local login; no production mutations.',
      },
      null,
      2,
    ),
  );
  console.log('PASS migration landing and unchanged historical detail preservation');
} finally {
  await browser.close();
}
