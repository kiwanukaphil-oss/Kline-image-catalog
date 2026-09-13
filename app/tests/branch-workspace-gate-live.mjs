import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const checks = [];
let rejectEntry = false;
let sessionBranches = [
  { id: 'main', name: 'MAIN', code: 'MAIN', can_switch_to: true },
  { id: 'namugongo', name: 'NAMUGONGO', code: 'NAM', can_switch_to: true },
  { id: 'restricted', name: 'Restricted branch', code: 'NO', can_switch_to: false },
];
const merchandiseRequests = [];
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(error.message));
// Every API call is intercepted; this regression suite cannot change real catalog records.
await page.route('**/api/**', async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const branch = request.headers()['x-branch-id'];
  if (path.endsWith('/auth/login'))
    return route.fulfill({
      json: { token: 'fixture-token', user: { id: 'user', default_branch_id: 'main' } },
    });
  if (path.endsWith('/catalog/session')) {
    if (!branch)
      return route.fulfill({ status: 400, json: { message: 'Select a branch before continuing.' } });
    if (rejectEntry && branch)
      return route.fulfill({ status: 403, json: { message: 'Branch access was revoked.' } });
    return route.fulfill({
      json: {
        data: {
          id: 'user',
          username: 'fixture',
          full_name: 'Test User',
          branches: sessionBranches,
          default_branch_id: 'main',
          can_edit: false,
          can_upload: false,
          can_publish: false,
          can_view_cost: false,
          can_ai_extract: false,
        },
      },
    });
  }
  if (path.endsWith('/auth/me'))
    return route.fulfill({ json: { user: { id: 'user', default_branch_id: 'main' } } });
  merchandiseRequests.push({ path, branch });
  if (path.endsWith('/catalog/reference-data'))
    return route.fulfill({ json: { data: { categories: [], fields: [] } } });
  if (path.endsWith('/batches') || path.endsWith('/product-matches')) return route.fulfill({ json: [] });
  return route.fulfill({ json: { items: [], total: 0, total_units: 0, limit: 48 } });
});

/** Exercise actual sign-in controls so the server's default branch cannot bypass the gate. */
async function signInToGate() {
  await page.getByLabel('Username', { exact: true }).fill('fixture');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Choose your branch workspace' }).waitFor();
  assert.equal(await page.getByRole('radio', { checked: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Enter workspace', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('radio', { name: 'Restricted branch', exact: true }).count(), 0);
}

try {
  await page.goto('https://klinemen-catalog.com');
  await signInToGate();
  assert.equal(merchandiseRequests.length, 0);
  checks.push('Fresh login ignores default branch and loads no merchandise before explicit selection');
  await page.screenshot({ path: '../verification/branch-gate-login-fix-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../verification/branch-gate-login-fix-mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole('radio', { name: 'NAMUGONGO', exact: true }).check();
  rejectEntry = true;
  await page.getByRole('button', { name: 'Enter workspace', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Branch access was revoked.' }).waitFor();
  assert.equal(merchandiseRequests.length, 0);
  checks.push('Rejected branch entry stays at gate without reading merchandise');
  rejectEntry = false;
  await page.getByRole('button', { name: 'Enter workspace', exact: true }).click();
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).waitFor();
  assert(merchandiseRequests.length > 0);
  assert(merchandiseRequests.every((request) => request.branch === 'namugongo'));
  await page.reload();
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Choose your branch workspace' }).count(), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('kline.branch')), 'namugongo');
  checks.push('Chosen non-default branch survives reload');
  await page.evaluate(() => window.dispatchEvent(new Event('kline-session-expired')));
  const resume = page.getByRole('dialog', { name: 'Sign in to continue', exact: true });
  await resume.getByLabel('Password', { exact: true }).fill('fixture-password');
  await resume.getByRole('button', { name: 'Sign in', exact: true }).click();
  await resume.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => sessionStorage.getItem('kline.branch')), 'namugongo');
  checks.push('Same-account session recovery preserves selected workspace');
  await page.evaluate(() =>
    window.addEventListener('kline-before-navigation', (event) => event.preventDefault(), { once: true }),
  );
  await page.getByRole('combobox', { name: 'Active branch' }).click();
  await page.getByRole('option', { name: 'MAIN', exact: true }).click();
  const navigationGuard = page.getByRole('dialog', { name: 'Leave unsaved work?', exact: true });
  await navigationGuard.getByRole('button', { name: 'Keep working', exact: true }).click();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('kline.branch')), 'namugongo');
  checks.push('Unsaved-work navigation guard still protects branch changes');
  await page.getByRole('combobox', { name: 'Active branch' }).click();
  await page.getByRole('option', { name: 'MAIN', exact: true }).click();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('kline.branch')), 'main');
  checks.push('Existing branch switcher works without signing out');
  await page.getByRole('button', { name: 'Sign out', exact: true }).filter({ visible: true }).click();
  await signInToGate();
  checks.push('Sign-out and fresh login require another deliberate branch choice');
  await page.evaluate(() => {
    sessionStorage.setItem('kline.branch', 'main');
    sessionStorage.removeItem('kline.branch-owner');
  });
  await page.reload();
  await page.getByRole('heading', { name: 'Choose your branch workspace' }).waitFor();
  checks.push('Legacy automatic branch storage cannot bypass the gate');
  await page.evaluate(() => {
    sessionStorage.setItem('kline.branch', 'restricted');
    sessionStorage.setItem('kline.branch-owner', 'user');
  });
  await page.reload();
  await page.getByRole('heading', { name: 'Choose your branch workspace' }).waitFor();
  checks.push('Remembered inaccessible branch returns to the gate');
  sessionBranches = [sessionBranches[1]];
  await page.reload();
  await page.getByRole('heading', { name: 'Choose your branch workspace' }).waitFor();
  assert.equal(await page.getByRole('radio', { checked: true }).count(), 0);
  checks.push('Single authorized branch still requires explicit selection');
  sessionBranches = [];
  await page.reload();
  await page.getByRole('alert').filter({ hasText: 'No branch workspace' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Enter workspace', exact: true }).isDisabled(), true);
  checks.push('No authorized branches fails closed with useful guidance');
  assert.deepEqual(browserErrors, []);
  await fs.writeFile(
    '../verification/branch-gate-login-fix-live.json',
    JSON.stringify({ passed: true, checks }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, checks }));
} finally {
  await browser.close();
}

