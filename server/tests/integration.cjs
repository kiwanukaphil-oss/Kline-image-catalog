const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { configureTestEnvironment } = require('./environment.cjs');
const { installLocalImageStore } = require('./local-images.cjs');

/** Real HTTP, POS services and PostgreSQL verify the commercial boundaries of the new workspace. */
async function verifyWorkspaceIntegration() {
  const dependencies = configureTestEnvironment();
  installLocalImageStore(dependencies);
  const { createLocalHost } = require('../local-host.cjs');
  const { pool } = dependencies.source('config/database');
  const server = createLocalHost(dependencies).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const branch = '00000000-0000-4000-b111-000000000001',
    category = '00000000-0000-4000-0300-000000000001';
  const checks = [];
  let token = '';
  async function call(
    route,
    body,
    method = body ? 'POST' : 'GET',
    expected = 200,
    auth = token,
    branchId = branch,
  ) {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        'X-Branch-Id': branchId,
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    assert.equal(response.status, expected, `${route}: ${JSON.stringify(result)}`);
    return result;
  }
  const pass = (name) => {
    checks.push(name);
    console.log('PASS', name);
  };
  try {
    token = (await call('/auth/login', { username: 'testadmin', password: 'testpass123' })).token;
    const session = (await call('/catalog/session')).data;
    assert.equal(session.can_publish, true);
    pass('Existing POS identity and branch capabilities');
    const cashier = (await call('/auth/login', { username: 'testcashier', password: 'testpass123' })).token;
    await call('/catalog-workspace/stock', null, 'GET', 401, '');
    await call('/catalog-workspace/stock', null, 'GET', 400, cashier, randomUUID());
    pass('Unauthenticated and unauthorized branch reads rejected');
    const baseline = await call('/catalog-workspace/stock');
    assert(
      baseline.products.some((product) => product.product_id === '00000000-0000-4000-e000-000000000001'),
    );
    pass('POS-only merchandise is present without catalog imagery');
    const batchId = randomUUID(),
      itemId = randomUUID();
    await call('/catalog-workspace/batches', { id: batchId, title: 'Integration · six-unit delivery' });
    await call('/catalog-workspace/batches', { id: batchId, title: 'Integration · six-unit delivery' });
    pass('Delivery creation retries preserve one identity');
    const image = await fs.readFile(path.join(__dirname, '../../design/assets/item-0.jpg'));
    const upload = () => {
      const form = new FormData();
      form.set('id', itemId);
      form.set('category_id', category);
      form.set('status', 'draft');
      form.set('image', new Blob([image], { type: 'image/jpeg' }), 'trousers.jpg');
      return form;
    };
    await call('/catalog/items', upload(), 'POST', 201);
    await call('/catalog/items', upload());
    await call(`/catalog-workspace/batches/${batchId}/items/${itemId}`, null, 'PUT');
    await call(`/catalog-workspace/batches/${batchId}/items/${itemId}`, null, 'PUT');
    const batchRows = await call('/catalog-workspace/batches');
    assert.equal(batchRows.find((batch) => batch.id === batchId).item_count, 1);
    pass('Interrupted upload and membership retries do not duplicate the lot');
    const detail = () => call(`/catalog-workspace/items/${itemId}`);
    let current = await detail();
    const details = {
      expected_revision: current.revision,
      name: 'Integration straight-leg trousers',
      brand: 'K-Line',
      category_id: category,
      attributes: { material: 'Cotton', color: 'Sand' },
    };
    await call(`/catalog-workspace/items/${itemId}`, details, 'PATCH');
    await call(`/catalog-workspace/items/${itemId}`, details, 'PATCH', 409);
    pass('Stale details cannot overwrite later edits');
    current = await detail();
    const count = {
      expected_revision: current.revision,
      entries: [
        { variant_attributes: { size: '30' }, quantity: 1 },
        { variant_attributes: { size: '32' }, quantity: 2 },
        { variant_attributes: { size: '34' }, quantity: 3 },
      ],
    };
    await call(`/catalog-workspace/items/${itemId}/count`, count, 'PATCH');
    await call(`/catalog-workspace/items/${itemId}/count`, count, 'PATCH', 409);
    pass('Six units across three sizes are confirmed with stale-count protection');
    const lotTotals = await call(`/catalog-workspace/items?batch_id=${batchId}`);
    assert.equal(lotTotals.total, 1);
    assert.equal(lotTotals.total_units, 6);
    const beyondPage = await call(`/catalog-workspace/items?batch_id=${batchId}&page=2`);
    assert.equal(beyondPage.items.length, 0);
    assert.equal(beyondPage.total_units, 6);
    const unmatched = await call(`/catalog-workspace/items?batch_id=${batchId}&search=no-such-lot`);
    assert.equal(unmatched.total_units, 0);
    const deliveryTotals = await call('/catalog-workspace/batches');
    assert.equal(deliveryTotals.find(row => row.id === batchId).total_units, 6);
    pass('Unit totals cover the complete filtered result and delivery, independently of pagination');
    const beforeReceive = await call('/catalog-workspace/stock');
    assert.equal(beforeReceive.total, baseline.total);
    pass('Draft stock never adds to current POS stock');
    const pricing = async (auth = token) =>
      (await call('/catalog/pricing/workspace', { item_ids: [itemId] }, 'POST', 200, auth)).data.items[0];
    let priced = await pricing();
    const retail = {
      retail_mode: 'fill',
      cost_mode: 'leave',
      items: [
        {
          id: itemId,
          expected_revision: priced.revision,
          target_line_ids: priced.lines.map((line) => line.id),
          base_price: 90000,
          lines: [
            {
              id: priced.lines.find((line) => line.variant_attributes.size === '34').id,
              price_override: 100000,
            },
          ],
        },
      ],
    };
    const plan = (await call('/catalog/pricing/preview', retail)).data;
    assert.deepEqual(
      plan.rows
        .sort((a, b) => a.variant_attributes.size.localeCompare(b.variant_attributes.size))
        .map((row) => row.price_after),
      [90000, 90000, 100000],
    );
    await Promise.all([
      call(`/catalog/pricing/plans/${plan.id}/apply`, {}),
      call(`/catalog/pricing/plans/${plan.id}/apply`, {}),
    ]);
    pass('Shared retail price and one size exception apply once');
    priced = await pricing();
    const cost = {
      retail_mode: 'leave',
      cost_mode: 'fill',
      items: [
        {
          id: itemId,
          expected_revision: priced.revision,
          target_line_ids: priced.lines.map((line) => line.id),
          base_cost_price: 45000,
          lines: [],
        },
      ],
    };
    const costPlan = (await call('/catalog/pricing/preview', cost)).data;
    await call(`/catalog/pricing/plans/${costPlan.id}/apply`, {});
    assert.deepEqual(
      (await pricing()).lines
        .sort((a, b) => a.variant_attributes.size.localeCompare(b.variant_attributes.size))
        .map((line) => line.effective_price),
      [90000, 90000, 100000],
    );
    pass('Cost-only pricing preserves retail values');
    const redacted = await pricing(cashier);
    assert(!JSON.stringify(redacted).includes('cost'));
    pass('Non-cost staff receive no cost fields');
    priced = await pricing();
    const fillAgain = {
      ...retail,
      items: [{ ...retail.items[0], expected_revision: priced.revision, base_price: 120000, lines: [] }],
    };
    await call('/catalog/pricing/preview', fillAgain, 'POST', 400);
    pass('Fill missing prices protects inherited and individual existing prices');
    const changePlan = (
      await call('/catalog/pricing/preview', {
        retail_mode: 'revise',
        items: [
          {
            id: itemId,
            expected_revision: priced.revision,
            target_line_ids: [priced.lines[0].id],
            lines: [{ id: priced.lines[0].id, price_override: 95000, replace_price_override: true }],
          },
        ],
      })
    ).data;
    current = await detail();
    await call(
      `/catalog-workspace/items/${itemId}`,
      { ...details, expected_revision: current.revision, name: details.name + ' reviewed' },
      'PATCH',
    );
    await call(`/catalog/pricing/plans/${changePlan.id}/apply`, {}, 'POST', 409);
    pass('A stale reviewed price plan cannot apply');
    current = await detail();
    assert.deepEqual(current.blockers, []);
    pass('Authoritative readiness agrees with publication requirements');
    await call(`/catalog-workspace/items/${itemId}/receive`, {}, 'POST', 400);
    await call(
      `/catalog-workspace/items/${itemId}/receive`,
      { expected_revision: current.publication_revision },
      'POST',
      403,
      cashier,
    );
    const cashierReview = await call(`/catalog-workspace/items/${itemId}`, null, 'GET', 200, cashier);
    assert(!JSON.stringify(cashierReview).includes('cost_price'));
    await call(
      `/catalog-workspace/items/${itemId}/receive`,
      { expected_revision: cashierReview.publication_revision },
      'POST',
      409,
    );
    const staleReceiptRevision = current.publication_revision;
    await call(
      `/catalog-workspace/items/${itemId}`,
      { ...details, expected_revision: current.revision, name: details.name + ' final' },
      'PATCH',
    );
    await call(
      `/catalog-workspace/items/${itemId}/receive`,
      { expected_revision: staleReceiptRevision },
      'POST',
      409,
    );
    assert.equal(
      (
        await pool.query(
          'SELECT COUNT(*)::int AS count FROM inventory.catalog_publications WHERE item_id=$1',
          [itemId],
        )
      ).rows[0].count,
      0,
    );
    current = await detail();
    pass('Receiving requires a current actor-scoped review and publish permission without exposing costs');
    const outcomes = await Promise.all([
      call(`/catalog-workspace/items/${itemId}/receive`, { expected_revision: current.publication_revision }),
      call(`/catalog-workspace/items/${itemId}/receive`, { expected_revision: current.publication_revision }),
    ]);
    const productId = outcomes[0].product_id;
    let stock = await call(
      `/catalog-workspace/stock?search=${encodeURIComponent('Integration straight-leg')}`,
    );
    const product = stock.products.find((product) => product.product_id === productId);
    assert.equal(product.quantity, 6);
    pass('Concurrent receipt retries create exactly six POS units');
    await call(`/catalog-workspace/items/${itemId}/count`, count, 'PATCH', 409);
    await call(`/catalog-workspace/items/${itemId}`, details, 'PATCH', 409);
    pass('Received lot identity and counts cannot be changed through workspace edits');
    const receiptBefore = (await call(`/catalog-workspace/receipts?batch_id=${batchId}`))[0];
    assert.equal(receiptBefore.total_units, 6);
    const size30 = product.variants.find((line) => line.variant_attributes.size === '30');
    await call(
      '/sales',
      { items: [{ variant_id: size30.id, quantity: 1 }], payment_method: 'card', amount_paid: 90000 },
      'POST',
      201,
    );
    stock = await call(`/catalog-workspace/stock?search=${encodeURIComponent('Integration straight-leg')}`);
    assert.equal(stock.products.find((product) => product.product_id === productId).quantity, 5);
    const receiptAfter = (await call(`/catalog-workspace/receipts?batch_id=${batchId}`))[0];
    assert.deepEqual(receiptAfter, receiptBefore);
    pass('A real POS sale reduces stock to five while the receipt remains six');
    const depleted = await call(`/catalog-workspace/stock?size=30&state=out`);
    assert.equal(depleted.products.find((product) => product.product_id === productId).quantity, 0);
    pass('Size-scoped quantities and depleted sizes remain visible');
    const movements = await call(`/catalog-workspace/stock/${productId}/movements`);
    assert(movements.some((row) => row.movement_type === 'sale' && row.quantity_change === -1));
    pass('Movement history includes the real POS sale');
    await call(`/catalog/pricing/plans/${plan.id}/undo`, {}, 'POST', 409);
    pass('Price undo cannot rewrite received stock');
    // Additional evidence links are fixtures for the read model, not another receipt.
    await pool.query(
      `INSERT INTO inventory.items(id,category_id,branch_id,name,image_path,pos_product_id,pos_sync_status)
       SELECT $2,category_id,branch_id,'Additional evidence',image_path,pos_product_id,'synced'
       FROM inventory.items WHERE id=$1`,
      [itemId, randomUUID()],
    );
    stock = await call(`/catalog-workspace/stock?search=${encodeURIComponent('Integration straight-leg')}`);
    assert.equal(stock.products.find((product) => product.product_id === productId).quantity, 5);
    pass('Multiple linked photos never multiply POS inventory');
    const size32 = product.variants.find((line) => line.variant_attributes.size === '32');
    const size34 = product.variants.find((line) => line.variant_attributes.size === '34');
    await pool.query('UPDATE branch_inventory SET reorder_level=2 WHERE branch_id=$1 AND variant_id=$2', [
      branch,
      size32.id,
    ]);
    await pool.query('UPDATE product_variants SET reorder_level=NULL WHERE id=$1', [size34.id]);
    await pool.query('UPDATE branch_inventory SET reorder_level=0 WHERE branch_id=$1 AND variant_id=$2', [
      branch,
      size34.id,
    ]);
    const publicationRepository = dependencies.source('repositories/CatalogPublicationRepository');
    const StockRepository = dependencies.source('repositories/StockRepository');
    await publicationRepository.withTransaction((client) =>
      StockRepository.updateStock(
        size30.id,
        -2,
        'adjustment',
        null,
        session.id,
        client,
        'Local discrepancy fixture',
        { branchId: branch, allowNegative: true },
      ),
    );
    const negative = await call('/catalog-workspace/stock?size=30&state=negative');
    assert.equal(negative.products.find((product) => product.product_id === productId).quantity, -2);
    const low = await call('/catalog-workspace/stock?size=32&state=low');
    assert.equal(low.products.find((product) => product.product_id === productId).quantity, 2);
    const missingThreshold = await call('/catalog-workspace/stock?size=34&state=low');
    assert(!missingThreshold.products.some((product) => product.product_id === productId));
    const unknownThresholdId = randomUUID();
    await pool.query(
      `INSERT INTO product_variants(id,product_id,sku,variant_attributes,price,cost_price,stock_quantity,reorder_level,is_active)
      VALUES($1,$2,$3,'{"size":"OS"}',25000,10000,0,NULL,true)`,
      [
        unknownThresholdId,
        '00000000-0000-4000-e000-000000000001',
        'NO-LIMIT-' + unknownThresholdId.slice(0, 8),
      ],
    );
    const unknownThreshold = await call('/catalog-workspace/stock?size=OS');
    assert(!unknownThreshold.products.flatMap((product) => product.variants)
      .some((line) => line.id === unknownThresholdId));
    assert(!unknownThreshold.sizes.includes('OS'));
    pass('Never-received variants are absent from branch stock and filter choices');
    pass('Negative balances remain signed and low-stock filters use configured thresholds');
    const secondBranch = randomUUID();
    await pool.query(
      "INSERT INTO branches(id,code,name,status,is_default) VALUES($1,$2,'Test Annex','active',false)",
      [secondBranch, 'T' + secondBranch.slice(0, 8)],
    );
    await publicationRepository.withTransaction((client) =>
      StockRepository.updateStock(
        size34.id,
        9,
        'purchase',
        null,
        session.id,
        client,
        'Local second-branch fixture',
        { branchId: secondBranch },
      ),
    );
    const otherStock = await call('/catalog-workspace/stock?size=34', null, 'GET', 200, token, secondBranch);
    assert.equal(otherStock.products.find((product) => product.product_id === productId).quantity, 9);
    const mainStock = await call('/catalog-workspace/stock?size=34');
    assert.equal(mainStock.products.find((product) => product.product_id === productId).quantity, 3);
    await call('/catalog-workspace/stock', null, 'GET', 400, cashier, secondBranch);
    await call(`/catalog-workspace/items/${itemId}`, null, 'GET', 404, token, secondBranch);
    pass('Authorized branches have independent balances and cannot read another branch draft');
    await fs.mkdir(path.join(__dirname, '../../verification'), { recursive: true });
    await fs.writeFile(
      path.join(__dirname, '../../verification/integration.json'),
      JSON.stringify(
        {
          passed: true,
          checked_at: new Date().toISOString(),
          database: process.env.DB_NAME,
          checks,
          receipt_id: receiptBefore.id,
        },
        null,
        2,
      ),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}
verifyWorkspaceIntegration().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
