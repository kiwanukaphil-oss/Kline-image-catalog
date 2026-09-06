import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { configureTestEnvironment } from '../../server/tests/environment.cjs';
const dependencies = configureTestEnvironment(),
  { pool } = dependencies.source('config/database');
const main = '00000000-0000-4000-b111-000000000001',
  destination = randomUUID();
const variant = (await pool.query("SELECT id,sku,price FROM product_variants WHERE sku='TSH-S-BLU'")).rows[0];
assert(variant);
await pool.query(
  "INSERT INTO branches(id,code,name,status,country) VALUES($1,$2,'Stock flow destination','active','Uganda')",
  [destination, 'FLOW-' + Date.now()],
);
await pool.query('INSERT INTO branch_settings(branch_id) VALUES($1)', [destination]);
await pool.query(
  "INSERT INTO user_branches(user_id,branch_id,is_default,can_switch_to) SELECT id,$1,false,true FROM users WHERE username='testadmin'",
  [destination],
);
let token = '';
/** Use only the real POS commerce endpoints for every stock change in this UI verification. */
async function call(route, body, branch = main) {
  const response = await fetch('http://127.0.0.1:5109/api' + route, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'X-Branch-Id': branch, 'Content-Type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  assert(response.ok, JSON.stringify(result));
  return result;
}
token = (await call('/auth/login', { username: 'testadmin', password: 'testpass123' })).token;
const before = Number(
  (
    await pool.query('SELECT stock_quantity FROM branch_inventory WHERE branch_id=$1 AND variant_id=$2', [
      main,
      variant.id,
    ])
  ).rows[0].stock_quantity,
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
/** Refresh the displayed balance and wait for its DOM value, including asynchronous branch changes. */
async function verifyBalance(quantity) {
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.waitForFunction((expected) => {
    const text = document.querySelector('.stock-card-count strong')?.textContent || '';
    return Number.parseInt(text.trim(), 10) === expected;
  }, quantity);
}
try {
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Stock', exact: true }).click();
  await page.getByLabel('Search product, brand, SKU or barcode').fill(variant.sku);
  await call('/inventory/adjust', {
    variant_id: variant.id,
    quantity_change: 5,
    movement_type: 'adjustment',
    reason: 'Workspace flow verification',
  });
  await verifyBalance(before + 5);
  const drawer = await call('/cash-drawer/active');
  if (!drawer.data) await call('/cash-drawer/open', { opening_float: 100000 });
  const sale = (
    await call('/sales', {
      items: [{ variant_id: variant.id, quantity: 1 }],
      payment_method: 'cash',
      amount_paid: Number(variant.price),
    })
  ).data;
  const saleItem = (await pool.query('SELECT id,unit_price FROM sale_items WHERE sale_id=$1', [sale.id]))
    .rows[0];
  await verifyBalance(before + 4);
  await call('/returns', {
    original_sale_id: sale.id,
    return_type: 'refund',
    return_reason: 'Workspace flow verification',
    refund_method: 'cash',
    items: [
      {
        original_sale_item_id: saleItem.id,
        variant_id: variant.id,
        quantity_returned: 1,
        condition: 'sellable',
        unit_price: Number(saleItem.unit_price),
      },
    ],
  });
  await verifyBalance(before + 5);
  const transfer = (
    await call('/inventory/transfers', {
      to_branch_id: destination,
      items: [{ variant_id: variant.id, requested_quantity: 2 }],
      notes: 'Workspace flow verification',
    })
  ).data;
  await call(`/inventory/transfers/${transfer.id}/dispatch`, {});
  await verifyBalance(before + 3);
  await call(`/inventory/transfers/${transfer.id}/receive`, {}, destination);
  await page.getByLabel('Active branch').selectOption(destination);
  await page.getByRole('button', { name: 'Stock', exact: true }).click();
  await page.getByLabel('Search product, brand, SKU or barcode').fill(variant.sku);
  await verifyBalance(2);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator('.stock-card').click();
  await page.getByText('transfer in', { exact: true }).waitFor();
  await page.screenshot({ path: '../verification/stock-flows-mobile.png' });
  await fs.writeFile(
    '../verification/stock-flows.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Real adjustment refreshes selected variant',
          'Sale and sellable return refresh the original branch',
          'Dispatch removes source stock',
          'Receipt adds destination stock without duplicating source',
          'Mobile destination movement history shows transfer in',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS real POS adjustment, sale/return and branch transfer in stock UI');
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
  await pool.end();
}
