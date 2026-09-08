const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { configureTestEnvironment } = require("./environment.cjs");
/** Exercise atomic grouped product creation, variant reuse/extension, branch permissions and safe retries against local PostgreSQL. */
async function verifyMatching() {
  const dependencies = configureTestEnvironment();
  require("./local-images.cjs").installLocalImageStore(dependencies);
  const { pool } = dependencies.source("config/database");
  // In-memory objects exercise the real handoff/gallery transaction without a production bucket.
  const storage = dependencies.source("services/railwayObjectStorageService");
  const objects = new Map();
  objects.set("matching-test.jpg", {
    buffer: Buffer.from("local-photo-fixture"),
    contentType: "image/jpeg",
    metadata: {},
  });
  storage.inspectPrivateObject = async (key) => {
    const object = objects.get(key);
    return { ...object, contentLength: object.buffer.length };
  };
  storage.downloadPrivateObject = async (key) => objects.get(key);
  storage.storePrivateObjectIfAbsent = async (object) => {
    if (!objects.has(object.objectKey)) objects.set(object.objectKey, object);
  };
  const { createLocalHost } = require("../local-host.cjs");
  const server = createLocalHost(dependencies).listen(0, "127.0.0.1");
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let token = "";
  const actor = (await pool.query("SELECT id FROM users WHERE username='testadmin'")).rows[0].id;
  const branch = "00000000-0000-4000-b111-000000000001";
  const category = (
    await pool.query("SELECT image_category_id FROM inventory.pos_category_map LIMIT 1")
  ).rows[0].image_category_id;
  async function call(path, body, expected = 200, branchId = branch, auth = token) {
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${auth}`,
        "X-Branch-Id": branchId,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  }
  async function seedLot(size, quantity = 1, price = 100000) {
    const id = randomUUID(),
      line = randomUUID();
    await pool.query(
      `INSERT INTO inventory.items(id,category_id,branch_id,name,brand,status,image_path,attributes,stock_quantity,stock_distribution_source,price,created_by,updated_by)
   VALUES($1,$2,$3,'Matching test shirt','Matching test brand','needs-review','matching-test.jpg','{"color":"Blue","fit":"Slim","material":"Cotton"}',$4,'human_confirmed',$5,$6,$6)`,
      [id, category, branch, quantity, price, actor],
    );
    await pool.query(
      "INSERT INTO inventory.item_costs(item_id,cost_price,updated_by) VALUES($1,50000,$2)",
      [id, actor],
    );
    await pool.query(
      `INSERT INTO inventory.item_variant_lines(id,item_id,position,variant_key,variant_attributes,quantity,updated_by) VALUES($1,$2,0,$3,$4,$5,$6)`,
      [line, id, size, JSON.stringify({ size }), quantity, actor],
    );
    return id;
  }
  const planBody = (ids) => ({
    item_ids: ids,
    product_name: "Matching test shirt",
    brand_name: "Matching test brand",
    variant_defaults: { color: "Blue", fit: "Slim" },
    review_note: "Exact same test model",
    confirm_differences: true,
  });
  try {
    token = (await call("/auth/login", { username: "testadmin", password: "testpass123" })).token;
    const a = await seedLot("XL", 2),
      b = await seedLot("XXL", 1),
      c = await seedLot("2XL", 2);
    const plan = await call("/catalog-workspace/product-matches", planBody([a, b, c]));
    await call("/catalog-workspace/product-matches", planBody([a]), 409);
    const detail = await call(`/catalog-workspace/items/${a}`);
    await call(
      `/catalog-workspace/items/${a}/receive`,
      { expected_revision: detail.publication_revision },
      400,
    );
    let review = await call(`/catalog-workspace/product-matches/${plan.id}/review`, {});
    assert.equal(review.variant_count, 2);
    assert.equal(review.total_units, 5);
    assert.equal(JSON.stringify(review).includes("cost"), false);
    await pool.query("UPDATE inventory.items SET name=$2 WHERE id=$1", [a, "Changed identity"]);
    await call(
      `/catalog-workspace/product-matches/${plan.id}/receive`,
      { expected_revision: review.revision },
      409,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM inventory.catalog_publications WHERE item_id=ANY($1)",
          [[a, b, c]],
        )
      ).rows[0].n,
      0,
    );
    review = await call(`/catalog-workspace/product-matches/${plan.id}/review`, {});
    const receipts = await Promise.all([
      call(`/catalog-workspace/product-matches/${plan.id}/receive`, {
        expected_revision: review.revision,
      }),
      call(`/catalog-workspace/product-matches/${plan.id}/receive`, {
        expected_revision: review.revision,
      }),
    ]);
    assert.equal(receipts[0].product_id, receipts[1].product_id);
    const productId = receipts[0].product_id;
    const variants = (
      await pool.query(
        "SELECT v.*,bi.stock_quantity AS branch_quantity FROM product_variants v JOIN branch_inventory bi ON bi.variant_id=v.id AND bi.branch_id=$2 WHERE v.product_id=$1",
        [productId, branch],
      )
    ).rows;
    assert.equal(variants.length, 2);
    assert.equal(
      variants.reduce((n, v) => n + v.branch_quantity, 0),
      5,
    );
    const gallery = (
      await pool.query("SELECT * FROM product_images WHERE product_id=$1", [productId])
    ).rows;
    assert.equal(gallery.length, 3);
    assert.equal(gallery.filter((photo) => photo.is_primary).length, 1);
    const primary = (await pool.query("SELECT image_path FROM products WHERE id=$1", [productId]))
      .rows[0].image_path;
    assert.equal(
      (
        await pool.query(
          "SELECT count(DISTINCT product_id)::int n FROM inventory.catalog_publications WHERE item_id=ANY($1)",
          [[a, b, c]],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM stock_movements WHERE reference_id=ANY(SELECT id FROM inventory.item_variant_lines WHERE item_id=ANY($1))",
          [[a, b, c]],
        )
      ).rows[0].n,
      3,
    );
    const d = await seedLot("XL", 3),
      e = await seedLot("L", 1);
    const restock = await call("/catalog-workspace/product-matches", {
      ...planBody([d, e]),
      target_product_id: productId,
    });
    const restockReview = await call(`/catalog-workspace/product-matches/${restock.id}/review`, {});
    assert.equal(restockReview.new_variants, 1);
    assert.equal(restockReview.existing_variants, 1);
    await call(`/catalog-workspace/product-matches/${restock.id}/receive`, {
      expected_revision: restockReview.revision,
    });
    assert.equal(
      (
        await pool.query("SELECT count(*)::int n FROM product_variants WHERE product_id=$1", [
          productId,
        ])
      ).rows[0].n,
      3,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT sum(bi.stock_quantity)::int n FROM branch_inventory bi JOIN product_variants v ON v.id=bi.variant_id WHERE v.product_id=$1 AND bi.branch_id=$2",
          [productId, branch],
        )
      ).rows[0].n,
      9,
    );
    assert.equal(
      (
        await pool.query("SELECT count(*)::int n FROM product_images WHERE product_id=$1", [
          productId,
        ])
      ).rows[0].n,
      5,
    );
    assert.equal(
      (await pool.query("SELECT image_path FROM products WHERE id=$1", [productId])).rows[0]
        .image_path,
      primary,
    );
    const f = await seedLot("S", 1),
      g = await seedLot("S", 1, 110000);
    await call("/catalog-workspace/product-matches", planBody([f, g]), 409);
    const removable = await call("/catalog-workspace/product-matches", planBody([f]));
    await call(
      `/catalog-workspace/product-matches/${removable.id}/unmatch`,
      { expected_revision: "stale" },
      409,
    );
    await call(`/catalog-workspace/product-matches/${removable.id}/unmatch`, {
      expected_revision: removable.revision,
    });
    assert(
      (
        await pool.query("SELECT retired_at FROM catalog_workspace.product_matches WHERE id=$1", [
          removable.id,
        ])
      ).rows[0].retired_at,
    );
    const cashier = (
      await call("/auth/login", { username: "testcashier", password: "testpass123" })
    ).token;
    await call("/catalog-workspace/product-matches", planBody([g]), 403, branch, cashier);
    await pool.query(
      `UPDATE product_variants SET variant_attributes=variant_attributes || '{"sleeve":"Long"}'::jsonb WHERE product_id=$1`,
      [productId],
    );
    await call(
      "/catalog-workspace/product-matches",
      { ...planBody([g]), target_product_id: productId },
      400,
    );
    // A complete sleeve dimension reuses the native size; a different sleeve gets its own variant.
    const longSleeve = await seedLot("XL"),
      shortSleeve = await seedLot("XL");
    await pool.query(
      `UPDATE inventory.items SET attributes=attributes || jsonb_build_object('sleeve',$2::text) WHERE id=$1`,
      [longSleeve, "Long sleeves"],
    );
    await pool.query(
      `UPDATE inventory.items SET attributes=attributes || jsonb_build_object('sleeve',$2::text) WHERE id=$1`,
      [shortSleeve, "Short"],
    );
    const sleevedPlan = await call("/catalog-workspace/product-matches", {
      ...planBody([longSleeve, shortSleeve]),
      target_product_id: productId,
    });
    const sleevedReview = await call(
      `/catalog-workspace/product-matches/${sleevedPlan.id}/review`,
      {},
    );
    assert.equal(sleevedReview.existing_variants, 1);
    assert.equal(sleevedReview.new_variants, 1);
    await call(`/catalog-workspace/product-matches/${sleevedPlan.id}/receive`, {
      expected_revision: sleevedReview.revision,
    });
    const sleeveRows = (
      await pool.query(
        "SELECT variant_attributes FROM product_variants WHERE product_id=$1 AND lower(variant_attributes->>'size')='xl'",
        [productId],
      )
    ).rows;
    assert.equal(sleeveRows.length, 2);
    assert.deepEqual(sleeveRows.map((row) => row.variant_attributes.sleeve.toLowerCase()).sort(), [
      "long",
      "short",
    ]);
    const rollbackIds = [await seedLot("M"), await seedLot("L")];
    const rollbackPlan = await call("/catalog-workspace/product-matches", planBody(rollbackIds));
    const rollbackReview = await call(
      `/catalog-workspace/product-matches/${rollbackPlan.id}/review`,
      {},
    );
    const stock = dependencies.source("repositories/StockRepository");
    const originalUpdate = stock.updateStock;
    let stockCalls = 0;
    stock.updateStock = async function (...args) {
      if (++stockCalls === 2) throw new Error("Simulated second stock write failure");
      return originalUpdate.apply(this, args);
    };
    try {
      await call(
        `/catalog-workspace/product-matches/${rollbackPlan.id}/receive`,
        { expected_revision: rollbackReview.revision },
        500,
      );
    } finally {
      stock.updateStock = originalUpdate;
    }
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM inventory.catalog_publications WHERE item_id=ANY($1)",
          [rollbackIds],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM stock_movements WHERE reference_id=ANY(SELECT id FROM inventory.item_variant_lines WHERE item_id=ANY($1))",
          [rollbackIds],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT result_product_id FROM catalog_workspace.product_matches WHERE id=$1",
          [rollbackPlan.id],
        )
      ).rows[0].result_product_id,
      null,
    );
    await call(`/catalog-workspace/product-matches/${rollbackPlan.id}/unmatch`, {
      expected_revision: rollbackPlan.revision,
    });
    console.log(
      "PASS grouped gallery: every photo retained, one primary, retries do not duplicate; missing native dimensions blocked; second stock failure rolls back entire group.",
    );
    console.log(
      "PASS grouped product: 3 lots -> 1 product / 2 variants / 5 units; exact retries; new size plus restock; stale review; overlap; conflicting prices; unmatch audit; publish permission.",
    );
  } finally {
    await new Promise((r) => server.close(r));
    await pool.end();
  }
}
verifyMatching().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
