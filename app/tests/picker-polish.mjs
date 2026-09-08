import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base = process.env.KLINE_PICKER_PREVIEW || 'http://localhost:5198';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local test workspace');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const evidence = '../.test-data/picker-polish';
await fs.mkdir(evidence, { recursive: true });

/** Verify real menu selection, branch context, keyboard operation, and responsive bounds without changing stock. */
async function verifyWorkspacePickers() {
  await page.goto(base);
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('testadmin');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('tab', { name: 'All merchandise', exact: true }).click();
  const task = page.getByRole('combobox', { name: 'Receiving task', exact: true });
  await task.click();
  await page.getByRole('option', { name: 'Confirm counts', exact: true }).click();
  assert.match(await task.innerText(), /Confirm counts/);
  await task.click();
  await page.getByRole('option', { name: 'All merchandise', exact: true }).click();
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  const sort = page.getByRole('combobox', { name: 'Receiving sort', exact: true });
  await sort.focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('listbox').waitFor();
  await page.waitForTimeout(150);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  assert.match(await sort.innerText(), /Name A/);
  const branch = page.getByRole('combobox', { name: 'Active branch', exact: true });
  await branch.click();
  await page.getByRole('option', { name: 'Namugongo preview', exact: true }).waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${evidence}/desktop-menu.png` });
  await page.getByRole('option', { name: 'Namugongo preview', exact: true }).click();
  assert.match(await branch.innerText(), /Namugongo preview/);
  await branch.click();
  await page.getByRole('option', { name: 'Test Store', exact: true }).click();
  await page.getByRole('tab', { name: 'All merchandise', exact: true }).click();
  await page.getByRole('button', { name: 'Use dark appearance', exact: true }).click();
  await page.getByRole('combobox', { name: 'Receiving category', exact: true }).click();
  await page.getByRole('listbox').waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${evidence}/dark-menu.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Use light appearance', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await sort.click();
  const popup = page.getByRole('listbox');
  await popup.waitFor();
  await page.waitForTimeout(250);
  const bounds = await popup.boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${evidence}/mobile-menu.png` });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1366, height: 900 });
  await page
    .getByRole('navigation', { name: 'Workspace', exact: true })
    .getByRole('button', { name: 'Stock', exact: true })
    .click();
  const stockCategory = page.getByRole('combobox', { name: 'Filter by category', exact: true });
  await stockCategory.click();
  await page.getByRole('option', { name: 'All categories', exact: true }).click();
  assert.match(await stockCategory.innerText(), /All categories/);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: receiving filters, keyboard selection, branch switching, stock picker, dark mode, mobile bounds, no browser errors',
  );
}

try {
  await verifyWorkspacePickers();
} finally {
  await browser.close();
}
