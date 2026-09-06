import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const origin = 'https://catalog-web-production-2d56.up.railway.app';
const api = 'https://pos-api-production-07c3.up.railway.app/api';
const branch = 'a1c58076-0210-4582-ba91-6da346ea602e';
const configuration = JSON.parse(
  (await fs.readFile('../.test-data/railway-staging-private.json', 'utf8')).replace(/^\uFEFF/, ''),
);
assert.equal(configuration.database.RAILWAY_PROJECT_ID, '9ce0cab6-9ab1-4da3-854b-afcf4cfa914b');
let token = '';
/** Call only the isolated staging API; never retry a paid or mutating request. */
async function call(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(api + path, {
    method,
    headers: {
      Authorization: `Bearer ${token || ''}`,
      'X-Branch-Id': branch,
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert(response.ok, JSON.stringify(result));
  return result;
}

token = (await call('/auth/login', configuration.account)).token;
assert.equal(
  (await call('/catalog-workspace/diagnostics')).ai_enabled,
  true,
  'Staging AI flag must be enabled',
);
const fixturePath = '../.test-data/railway-ai-fixture.json';
let fixture = await fs
  .readFile(fixturePath, 'utf8')
  .then(JSON.parse)
  .catch(() => null);
if (!fixture) {
  // Persist fixture identifiers before setup so reruns cannot silently submit duplicate paid work.
  fixture = { batch: randomUUID(), title: 'Live AI acceptance', items: [randomUUID(), randomUUID()] };
  await fs.writeFile(fixturePath, JSON.stringify(fixture));
}
if (!fixture.ready) {
  const schema = await call('/catalog-workspace/schema');
  const category = schema.categories.find((row) => row.name === 'Trousers').id;
  await call('/catalog-workspace/batches', { id: fixture.batch, title: fixture.title });
  for (const [index, id] of fixture.items.entries()) {
    const photo = new FormData();
    photo.set('id', id);
    photo.set('category_id', category);
    photo.set('status', 'draft');
    photo.set(
      'image',
      new Blob([await fs.readFile(`../design/assets/item-${index}.jpg`)], { type: 'image/jpeg' }),
      `live-ai-${index}.jpg`,
    );
    await call('/catalog/items', photo);
    const detail = await call(`/catalog-workspace/items/${id}`);
    assert(!detail.item.ai_run, 'Do not reset an item that has already run AI');
    await call(
      `/catalog-workspace/items/${id}`,
      {
        expected_revision: detail.revision,
        name: `Live AI review ${index + 1}`,
        brand: 'Staff-entered brand',
        category_id: category,
        attributes: { color: 'Staff-entered colour' },
      },
      'PATCH',
    );
    await call(`/catalog-workspace/batches/${fixture.batch}/items/${id}`, null, 'PUT');
  }
  fixture.ready = true;
  await fs.writeFile(fixturePath, JSON.stringify(fixture));
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
const extractions = [];
page.on('response', async (response) => {
  if (response.url().endsWith('/ai-extract'))
    extractions.push({ status: response.status(), body: await response.json().catch(() => ({})) });
});
try {
  // Exercise the real selected-photo UI and persisted review, without mocking OpenAI or storage.
  await page.goto(origin);
  await page.getByLabel('Username').fill(configuration.account.username);
  await page.getByLabel('Password', { exact: true }).fill(configuration.account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.delivery-card').filter({ hasText: fixture.title }).click();
  for (const index of [1, 2])
    await page.getByRole('checkbox', { name: `Select Live AI review ${index}`, exact: true }).check();
  await page.getByRole('button', { name: 'AI fill', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByText(/Ready|Previous attempt failed/)
    .first()
    .waitFor();
  const before = await Promise.all(fixture.items.map((id) => call(`/catalog-workspace/items/${id}`)));
  if (before.some((detail) => detail.item.ai_run?.status === 'failed'))
    throw new Error('Prior live attempt failed. Inspect saved evidence before authorizing a paid retry.');
  const fill = page.getByRole('button', { name: /^Fill \d photos?$/, exact: true });
  if (await fill.count()) await fill.click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('.ai-fill-row')].some((row) =>
        row.textContent.includes('Reading photo'),
      ),
    null,
    { timeout: 180000 },
  );
  const details = await Promise.all(fixture.items.map((id) => call(`/catalog-workspace/items/${id}`)));
  await page.screenshot({ path: '../verification/railway/ai-fill-desktop.png' });
  const observations = details.map(({ item }, index) => ({
    id: item.id,
    status: item.ai_run?.status,
    name_preserved: item.name === `Live AI review ${index + 1}`,
    brand_preserved: item.brand === 'Staff-entered brand',
    colour_preserved: item.attributes.color === 'Staff-entered colour',
    attributes: item.attributes,
    confidence: item.confidence,
    evidence: item.ai_field_evidence,
    visible_text: item.ai_visible_text,
    quantity_source: item.stock_distribution_source,
    published: item.is_published,
  }));
  await fs.writeFile(
    '../verification/railway/ai-provider.json',
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        observations,
        reopened_saved_runs: before.every((detail) => detail.item.ai_run?.status === 'succeeded'),
        new_extraction_requests: extractions.length,
        requests: extractions.map(({ status, body }) => ({
          status,
          success: body.success,
          message: body.message,
        })),
        staff_quality_acceptance: 'Pending real merchandise and staff review',
      },
      null,
      2,
    ),
  );
  for (const item of observations) {
    assert.equal(item.status, 'succeeded', JSON.stringify(extractions));
    assert(item.name_preserved && item.brand_preserved && item.colour_preserved);
    assert.equal(item.published, false);
    assert.notEqual(item.quantity_source, 'manual_confirmed');
  }
  await page.getByRole('button', { name: 'Review details', exact: true }).first().click();
  await page.getByLabel('Material', { exact: true }).waitFor();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForFunction(() => document.querySelector('[role="dialog"] img')?.naturalWidth > 0);
  await page.getByText('From photo', { exact: true }).first().click();
  await page.screenshot({ path: '../verification/railway/ai-review-mobile.png' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const report = JSON.parse(await fs.readFile('../verification/railway/ai-provider.json', 'utf8'));
  report.passed = true;
  report.mobile_photo_and_evidence = true;
  await fs.writeFile('../verification/railway/ai-provider.json', JSON.stringify(report, null, 2));
  console.log(
    'PASS real AI fill succeeds for two private photos, retains staff edits and requires quantity confirmation',
  );
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(-2000));
  throw error;
} finally {
  await browser.close();
}
