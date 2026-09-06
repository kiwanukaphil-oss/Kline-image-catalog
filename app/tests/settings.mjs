import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(15000);
try {
  // Create real category metadata, expose inherited fields, and verify POS administration paths from the compact settings area.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Workspace settings', exact: true });
  const users = settings.getByRole('link', { name: /Users and permissions/ });
  assert.equal(new URL(await users.getAttribute('href')).pathname, '/users');
  assert.equal(new URL(await users.getAttribute('href')).search, '');
  await settings.getByRole('button', { name: 'Categories and fields', exact: true }).click();
  const schema = page.getByRole('dialog', { name: 'Categories and fields', exact: true });
  await schema.getByRole('button', { name: 'New category', exact: true }).click();
  const name = 'Schema browser ' + Date.now();
  await schema.getByLabel('Category name', { exact: true }).fill(name);
  await schema.getByRole('button', { name: 'Add field', exact: true }).click();
  await schema.getByLabel('Label', { exact: true }).fill('Fabric');
  await schema.getByLabel('Field key', { exact: true }).fill('fabric');
  await schema.getByLabel('Required before receiving').check();
  await schema.getByRole('button', { name: 'Save category', exact: true }).click();
  await schema.getByText('Category saved', { exact: true }).waitFor();
  await schema.getByLabel('Category', { exact: true }).selectOption({ label: name });
  assert.equal(await schema.getByLabel('Field key', { exact: true }).isDisabled(), true);
  await schema.getByRole('button', { name: 'New category', exact: true }).click();
  await schema.getByLabel('Category name', { exact: true }).fill(name + ' child');
  await schema.getByLabel('Parent category', { exact: true }).selectOption({ label: name });
  await schema.getByText('Fabric (required)', { exact: true }).waitFor();
  await schema.getByRole('button', { name: 'Save category', exact: true }).click();
  await schema.getByText('Category saved', { exact: true }).waitFor();
  await schema
    .getByLabel('Category', { exact: true })
    .selectOption({ label: name + ' child \u00b7 ' + name });
  await schema.getByText('Fabric (required)', { exact: true }).waitFor();
  assert.equal(await schema.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  await page.screenshot({ path: '../verification/settings-mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.keyboard.press('Escape');
  await settings.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  await page.getByText('0.16.0', { exact: true }).waitFor();
  await fs.writeFile(
    '../verification/settings.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Separate settings area',
          'POS users URL contains no token',
          'Create category with required inheritable field',
          'Existing field identity readonly',
          'Child category inherited field preview',
          'Mobile no horizontal overflow',
          'Branch diagnostics reports installed version',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS category inheritance and administration navigation');
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
