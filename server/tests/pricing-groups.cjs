const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { configureTestEnvironment } = require('./environment.cjs');
const { installLocalImageStore } = require('./local-images.cjs');

/** Exercise the actual group compiler against POS previews, saves, stale checks and Undo in the isolated database. */
async function verifyGroupPricingIntegration() {
  const dependencies = configureTestEnvironment();
  installLocalImageStore(dependencies);
  const { createLocalHost } = require('../local-host.cjs');
  const { pool } = dependencies.source('config/database');
  const { compilePriceProposal } = await import('../../app/lib/pricing.ts');
  const { resolveGroupExceptions, validateGroupExceptions } = await import('../../app/lib/pricing-groups.ts');
  const server = createLocalHost(dependencies).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const branch = '00000000-0000-4000-b111-000000000001';
  const category = '00000000-0000-4000-0300-000000000001';
  let token;
  const checks = [];
  const pass = (name) => {
    checks.push(name);
    console.log('PASS', name);
  };
  async function call(route, body, method = body ? 'POST' : 'GET', expected = 200) {
    /* Keep every request on this ephemeral loopback host with the explicitly seeded branch. */
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Branch-Id': branch,
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    assert.equal(response.status, expected, `${route}: ${JSON.stringify(result)}`);
    return result;
  }
  try {
    token = (await call('/auth/login', { username: 'testadmin', password: 'testpass123' })).token;
    const ids = [];
    const image = await fs.readFile(path.join(__dirname, '../../design/assets/item-0.jpg'));
    for (const [index, brand] of ['Hugo Boss', 'Hugo Boss', 'H&M', 'Other'].entries()) {
      const id = randomUUID();
      ids.push(id);
      const form = new FormData();
      form.set('id', id);
      form.set('category_id', category);
      form.set('status', 'draft');
      form.set('image', new Blob([image], { type: 'image/jpeg' }), 'group-test.jpg');
      await call('/catalog/items', form, 'POST', 201);
      let detail = await call(`/catalog-workspace/items/${id}`);
      await call(
        `/catalog-workspace/items/${id}`,
        {
          expected_revision: detail.revision,
          name: `Group test ${index < 2 ? 'formal shirt' : 'shorts'} ${index}`,
          brand,
          category_id: category,
          attributes: { material: 'Cotton' },
        },
        'PATCH',
      );
      detail = await call(`/catalog-workspace/items/${id}`);
      await call(
        `/catalog-workspace/items/${id}/count`,
        {
          expected_revision: detail.revision,
          entries: ['M', 'XL'].map((size) => ({ variant_attributes: { size }, quantity: 2 })),
        },
        'PATCH',
      );
    }
    const workspace = async (itemIds) =>
      (await call('/catalog/pricing/workspace', { item_ids: itemIds })).data.items;
    const review = async (items, shared, rules, field = 'retail', intent = 'fill') => {
      const selected = items.flatMap((item) => item.lines.map((line) => line.id));
      const resolved = resolveGroupExceptions(items, selected, rules, {});
      validateGroupExceptions(rules, resolved);
      return (
        await call(
          '/catalog/pricing/preview',
          compilePriceProposal(items, selected, shared, resolved.exceptions, field, intent),
        )
      ).data;
    };
    let shirts = await workspace(ids.slice(0, 2));
    const sizeRules = [{ id: 'xl', brand: '', size: 'xl', price: '150000' }];
    const shirtPlan = await review(shirts, '100000', sizeRules);
    assert(
      shirtPlan.rows.every(
        (row) => row.price_after === (row.variant_attributes.size === 'XL' ? 150000 : 100000),
      ),
    );
    await call(`/catalog/pricing/plans/${shirtPlan.id}/apply`, {});
    shirts = await workspace(ids.slice(0, 2));
    assert(
      shirts.every((item) =>
        item.lines.every(
          (line) => line.effective_price === (line.variant_attributes.size === 'XL' ? 150000 : 100000),
        ),
      ),
    );
    pass('Compiled Hugo Boss size rule previews and persists 100,000 / 150,000 through real POS');
    const shorts = await workspace(ids.slice(2));
    const shortPlan = await review(shorts, '60000', [{ id: 'hm', brand: 'h&m', size: '', price: '80000' }]);
    assert(shortPlan.rows.every((row) => row.price_after === (row.brand === 'H&M' ? 80000 : 60000)));
    await call(`/catalog/pricing/plans/${shortPlan.id}/apply`, {});
    pass('Compiled brand exception prices every H&M size and keeps other shorts on the shared price');
    const costPlan = await review(
      shirts,
      '40000',
      [{ id: 'xl-cost', brand: '', size: 'xl', price: '50000' }],
      'cost',
    );
    await call(`/catalog/pricing/plans/${costPlan.id}/apply`, {});
    assert(
      (await workspace(ids.slice(0, 2))).every((item) =>
        item.lines.every(
          (line) => line.effective_price === (line.variant_attributes.size === 'XL' ? 150000 : 100000),
        ),
      ),
    );
    pass('Grouped cost exceptions leave selling prices unchanged');
    const stale = await review(await workspace(ids.slice(2)), '90000', [], 'retail', 'revise');
    await call(`/catalog/pricing/plans/${shortPlan.id}/undo`, {});
    await call(`/catalog/pricing/plans/${stale.id}/apply`, {}, 'POST', 409);
    assert(
      (await workspace(ids.slice(2))).every((item) =>
        item.lines.every((line) => line.effective_price === null),
      ),
    );
    pass('Undo restores the group and a stale reviewed group cannot overwrite it');
    await fs.writeFile(
      path.join(__dirname, '../../verification/pricing-groups-integration.json'),
      JSON.stringify({ passed: true, checked_at: new Date().toISOString(), checks }, null, 2),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}
verifyGroupPricingIntegration().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
