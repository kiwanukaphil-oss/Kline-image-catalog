import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { configureTestEnvironment } from '../../server/tests/environment.cjs';
import { installLocalImageStore } from '../../server/tests/local-images.cjs';
import { createLocalHost } from '../../server/local-host.cjs';

const dependencies = configureTestEnvironment();
process.env.CATALOG_AI_ENABLED = 'true';
process.env.OPENAI_API_KEY = 'local-provider-fixture-not-a-real-key';
process.env.OPENAI_MAX_ATTEMPTS = '1';
installLocalImageStore(dependencies);
const originalFetch = global.fetch;
let providerCalls = 0,
  failNext = false;
// Only the external inference boundary is replaced. Authentication, AI jobs, filling and review use real POS/PostgreSQL.
global.fetch = async (url, options) => {
  if (String(url) !== 'https://api.openai.com/v1/responses') return originalFetch(url, options);
  providerCalls++;
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (failNext) {
    failNext = false;
    return new Response(JSON.stringify({ error: { message: 'Fixture outage' } }), { status: 503 });
  }
  const extraction = {
    visible_text: 'WAIST 34 · TWO PIECES',
    values: {
      name: 'AI replacement name',
      brand: 'AI replacement brand',
      material: 'Cotton',
      color: 'Green',
      size: '34',
    },
    confidence: { name: 'Medium', brand: 'Medium', material: 'Medium', color: 'High', size: 'High' },
    evidence: {
      name: { source: 'visual_observation', observation: 'Trouser shape visible' },
      brand: { source: 'visual_inference', observation: 'Brand is unclear' },
      material: { source: 'visual_inference', observation: 'Matte woven fabric; fibre label not visible' },
      color: { source: 'visual_observation', observation: 'Green fabric' },
      size: { source: 'printed_label', observation: '34 printed on label' },
    },
    stock_distribution: {
      detected: true,
      evidence_text: 'TWO PIECES',
      entries: [{ variant_attributes: { size: '34' }, quantity: 2 }],
      confidence: 'High',
    },
  };
  return new Response(
    JSON.stringify({
      id: 'fixture-response-' + providerCalls,
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(extraction) }] }],
      usage: { input_tokens: 20, output_tokens: 20 },
    }),
    { status: 200 },
  );
};
const server = createLocalHost(dependencies).listen(0, '127.0.0.1');
await new Promise((resolve) => server.on('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
const branch = '00000000-0000-4000-b111-000000000001';
const category = '00000000-0000-4000-0300-000000000001';
let token = '';
/** Make authenticated fixture requests through the complete server boundary. */
async function call(route, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(base + route, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Branch-Id': branch,
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert(response.ok, JSON.stringify(data));
  return data;
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
const checks = [],
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const pass = (message) => {
  checks.push(message);
  console.log('PASS', message);
};
try {
  token = (await call('/auth/login', { username: 'testadmin', password: 'testpass123' })).token;
  const ids = [randomUUID(), randomUUID()];
  const title = 'AI workflow ' + Date.now(),
    batchId = randomUUID();
  await call('/catalog-workspace/batches', { id: batchId, title });
  for (const [index, id] of ids.entries()) {
    const photo = new FormData();
    photo.set('id', id);
    photo.set('category_id', category);
    photo.set('status', 'draft');
    photo.set(
      'image',
      new Blob([await fs.readFile('design/assets/item-0.jpg')], { type: 'image/jpeg' }),
      'trousers.jpg',
    );
    await call('/catalog/items', photo);
    const detail = await call(`/catalog-workspace/items/${id}`);
    await call(
      `/catalog-workspace/items/${id}`,
      {
        expected_revision: detail.revision,
        name: `AI review lot ${index + 1}`,
        brand: 'Staff brand',
        category_id: category,
        attributes: { color: 'Blue' },
      },
      'PATCH',
    );
    await call(`/catalog-workspace/batches/${batchId}/items/${id}`, null, 'PUT');
  }
  await page.route('http://127.0.0.1:5109/api/**', (route) =>
    route.continue({ url: route.request().url().replace('http://127.0.0.1:5109/api', base) }),
  );
  await page.goto(process.env.KLINE_PREVIEW_URL || 'http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Receiving', exact: true }).waitFor();
  await page.locator('.delivery-card').filter({ hasText: title }).click();
  for (const index of [1, 2])
    await page.getByRole('checkbox', { name: `Select AI review lot ${index}`, exact: true }).check();
  await page.getByRole('button', { name: 'AI fill', exact: true }).click();
  failNext = true;
  await page.getByRole('button', { name: 'Fill 2 photos', exact: true }).click();
  await page.getByRole('button', { name: 'Check saved progress', exact: true }).waitFor();
  assert.equal(providerCalls, 1);
  await page.getByRole('button', { name: 'Check saved progress', exact: true }).click();
  await page.getByRole('button', { name: 'Fill 2 photos', exact: true }).click();
  await page.getByRole('button', { name: 'Stop after this photo', exact: true }).click();
  await page.getByRole('button', { name: 'Fill 1 photo', exact: true }).waitFor();
  assert.equal(providerCalls, 2);
  await page.getByRole('button', { name: 'Fill 1 photo', exact: true }).click();
  await page
    .getByText(/details filled · Review/)
    .first()
    .waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.ai-fill-row')].every((row) => row.textContent.includes('details filled')),
  );
  assert.equal(providerCalls, 3);
  pass(
    'Selected photos fill sequentially; a provider failure pauses and only retries after checking saved progress',
  );
  const filled = await call(`/catalog-workspace/items/${ids[0]}`);
  assert.equal(filled.item.name, 'AI review lot 1');
  assert.equal(filled.item.brand, 'Staff brand');
  assert.equal(filled.item.attributes.color, 'Blue');
  assert.equal(filled.item.attributes.material, 'Cotton');
  assert.equal(filled.item.stock_distribution_source, 'ai_suggested');
  assert.equal(filled.item.ai_run.status, 'succeeded');
  pass('AI preserves existing staff details and records suggested quantities separately from confirmation');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  for (const index of [1, 2])
    await page.getByRole('checkbox', { name: `Select AI review lot ${index}`, exact: true }).check();
  await page.getByRole('button', { name: 'AI fill', exact: true }).click();
  await page.getByText('Ready to review', { exact: true }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: /^Fill \d/ }).count(), 0);
  assert.equal(providerCalls, 3);
  await page.getByRole('button', { name: 'Review details', exact: true }).first().click();
  await page.getByLabel('Material', { exact: true }).waitFor();
  await page.getByText('Check suggestion', { exact: true }).click();
  await page.getByText('Matte woven fabric; fibre label not visible', { exact: true }).waitFor();
  await page.screenshot({ path: 'verification/ai-review-desktop.png' });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByLabel('Material', { exact: true }).fill('Linen');
  assert(await page.getByRole('button', { name: 'AI fill', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Save reviewed details', exact: true }).click();
  await page.getByText('Details saved', { exact: true }).waitFor();
  assert.equal(await page.getByText('Check suggestion', { exact: true }).count(), 0);
  await page.getByRole('tab', { name: 'Sizes & quantities' }).click();
  await page
    .getByText('Suggested from the photo. Confirm the physical sizes and quantities.', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Confirm 2 units', exact: true }).click();
  await page.getByText('Size quantities confirmed', { exact: true }).waitFor();
  await page.screenshot({ path: 'verification/ai-review-mobile.png' });
  pass(
    'Reopening reuses saved results; evidence guides correction and reviewed details plus physical counts save on mobile',
  );
  await page.getByRole('tab', { name: 'Details', exact: true }).click();
  await page.route('**/ai-extract', async (route) => {
    // Lose only the response after the real server has persisted this explicitly requested single-photo run.
    const completed = await route.fetch({
      url: route.request().url().replace('http://127.0.0.1:5109/api', base),
    });
    assert.equal(completed.status(), 200);
    await route.abort('connectionreset');
  });
  const beforeLostResponse = providerCalls;
  await page.getByRole('dialog').getByRole('button', { name: 'AI fill', exact: true }).click();
  await page.getByRole('button', { name: 'Check saved progress', exact: true }).click();
  await page.getByLabel('Material', { exact: true }).waitFor();
  assert.equal(providerCalls, beforeLostResponse + 1);
  assert.equal(await page.getByLabel('Material', { exact: true }).inputValue(), 'Linen');
  pass(
    'A lost AI response is reconciled from saved progress without automatically paying for another request',
  );
  const { rows } = await dependencies
    .source('config/database')
    .pool.query(
      "SELECT after_value FROM inventory.item_events WHERE item_id=ANY($1::uuid[]) AND source='manual' ORDER BY created_at DESC",
      [ids],
    );
  assert(rows.some((row) => row.after_value.reviewed_ai_fields?.includes('material')));
  const reviewed = await Promise.all(ids.map((id) => call(`/catalog-workspace/items/${id}`)));
  assert(
    reviewed.some(
      (row) =>
        row.item.attributes.material === 'Linen' &&
        !row.item.confidence.material &&
        row.item.stock_distribution_source === 'human_confirmed',
    ),
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    'verification/ai-fill-browser.json',
    JSON.stringify(
      {
        passed: true,
        checked_at: new Date().toISOString(),
        provider: 'deterministic external-boundary fixture; not real AI accuracy',
        checks,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await dependencies.source('config/database').pool.end();
  global.fetch = originalFetch;
}
