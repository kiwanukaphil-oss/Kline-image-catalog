const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { configureTestEnvironment } = require('./environment.cjs');

/** Verify totals over multiple pages, filtered sizes and branch assortment using only local disposable data. */
async function verifyStockTotals() {
  const dependencies = configureTestEnvironment();
  const { pool } = dependencies.source('config/database');
  const repository = dependencies.source('repositories/CatalogPublicationRepository');
  const service = require('../workspace-service.cjs').createWorkspaceService(dependencies);
  const prefix = `Unit totals ${randomUUID()}`;
  try {
    const actor = (await pool.query("SELECT id FROM users WHERE username='testadmin'")).rows[0].id;
    const branches = (await pool.query('SELECT id FROM branches ORDER BY id LIMIT 2')).rows;
    assert.equal(branches.length, 2);
    const branch = branches[0].id, otherBranch = branches[1].id;
    const category = (await pool.query('SELECT pos_category_id FROM inventory.pos_category_map LIMIT 1')).rows[0].pos_category_id;
    for (let index = 0; index < 50; index++) {
      const product = await repository.createProduct(pool, {
        name: `${prefix} ${index}`, categoryId: category, basePrice: 100000,
        masterSku: `TOTAL-${randomUUID()}`, userId: actor,
      });
      for (const [size, quantity] of [['M', 1], ['L', 2]]) {
        const variant = await repository.createVariant(pool, {
          productId: product.id, sku: `TOTAL-${randomUUID()}`, attributes: { size },
          price: 100000, costPrice: 50000, reorderLevel: 0,
        });
        await pool.query(`INSERT INTO branch_inventory(branch_id,variant_id,stock_quantity,reorder_level,is_assorted)
          VALUES($1,$2,$3,0,true),($4,$2,99,0,true)`, [branch,variant.id,quantity,otherBranch]);
      }
    }
    const read = (filters = {}, branchId = branch) => service.stock(branchId, { search: prefix, page: 1, ...filters });
    for (const [page, expectedRows] of [[1,48],[2,2],[3,0]]) {
      const result = await read({ page });
      assert.equal(result.products.length, expectedRows);
      assert.equal(result.total, 50); assert.equal(result.total_units, 150);
    }
    const size = await read({ size: 'L' });
    assert.equal(size.total, 50); assert.equal(size.total_units, 100);
    const categoryResult = await read({ categoryId: category });
    assert.equal(categoryResult.total_units, 150);
    const empty = await read({ size: 'XS' });
    assert.equal(empty.total, 0); assert.equal(empty.total_units, 0);
    const out = await read({ state: 'out' });
    assert.equal(out.total_units, 0);
    const other = await read({}, otherBranch);
    assert.equal(other.total_units, 9900);
    assert(!Object.hasOwn(size.products[0], 'total_units'));
    console.log('PASS stock totals: 50 products / 150 units across pages, size/category filters, empty results, empty final page and isolated branch quantities.');
  } finally { await pool.end(); }
}
verifyStockTotals().catch(error => { console.error(error); process.exitCode = 1; });
