import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base = 'http://127.0.0.1:5109/api',
  branch = '00000000-0000-4000-b111-000000000001';
let token = '';
/** Create a real applied receipt through POS so browser history and Undo exercise persisted state. */
async function call(route, body) {
  const response = await fetch(base + route, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'X-Branch-Id': branch, 'Content-Type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  assert(response.ok, JSON.stringify(result));
  return result;
}
token = (await call('/auth/login', { username: 'testadmin', password: 'testpass123' })).token;
const items = (await call('/catalog/pricing/workspace', { page: 1 })).data.items;
const item = items.find((row) => !row.is_published && row.lines.length && row.base_price !== 123457);
assert(item, 'A draft with size lines is required.');
const receipt = (
  await call('/catalog/pricing/preview', {
    retail_mode: 'revise',
    items: [
      {
        id: item.id,
        expected_revision: item.revision,
        target_line_ids: item.lines.map((line) => line.id),
        base_price: 123457,
        lines: [],
      },
    ],
  })
).data;
await call(`/catalog/pricing/plans/${receipt.id}/apply`, {});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
try {
  // Reload loses in-memory pricing state, but the persisted receipt remains reachable from History.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Pricing', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Pricing', exact: true }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Your pricing history', exact: true });
  await history
    .getByRole('button')
    .filter({ hasText: /sizes · Applied/ })
    .first()
    .click();
  await history.getByRole('cell').filter({ hasText: item.name }).first().waitFor();
  await history.getByRole('columnheader', { name: 'Price before' }).waitFor();
  await page.screenshot({ path: '../verification/pricing-history-desktop.png' });
  await page.setViewportSize({ width: 360, height: 800 });
  await history.getByRole('button', { name: 'Undo these prices', exact: true }).click();
  await history.getByRole('button', { name: 'Restore previous prices', exact: true }).click();
  await history.getByText(/· Undone$/).waitFor();
  await page.screenshot({ path: '../verification/pricing-history-mobile.png' });
  assert.equal((await call(`/catalog/pricing/plans/${receipt.id}`)).data.status, 'undone');
  const restored = (await call('/catalog/pricing/workspace', { item_ids: [item.id] })).data.items[0];
  assert.equal(restored.base_price, item.base_price);
  await fs.writeFile(
    '../verification/pricing-history-browser.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Applied POS receipt survives browser reload',
          'Exact before/after rows visible from history',
          'Mobile confirmed Undo restores the earlier base price',
          'Undo status persists in POS ledger',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS pricing history after reload and mobile protected Undo');
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
