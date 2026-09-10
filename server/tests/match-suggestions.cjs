const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const { configureTestEnvironment } = require("./environment.cjs");

/** Exercise discovery and decisions over real local PostgreSQL with the production authentication and receipt services. */
async function verifySuggestions() {
  const dependencies = configureTestEnvironment();
  require("./local-images.cjs").installLocalImageStore(dependencies);
  const { pool } = dependencies.source("config/database");
  await pool.query(fs.readFileSync("server/migrations/002_match_suggestions.sql", "utf8"));
  const server = require("../local-host.cjs").createLocalHost(dependencies).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const branch = "00000000-0000-4000-b111-000000000001";
  const actor = (await pool.query("SELECT id FROM users WHERE username='testadmin'")).rows[0].id;
  const category = (
    await pool.query("SELECT image_category_id FROM inventory.pos_category_map LIMIT 1")
  ).rows[0].image_category_id;
  const batch = randomUUID();
  const fixtureBrand = `Suggestion fixture ${batch.slice(0, 8)}`;
  let token = "";
  async function call(path, body, expected = 200, auth = token, branchId = branch) {
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
  async function seed(model, size = "XL", attributes = {}, inBatch = true) {
    // Intentionally omit prices/costs and leave counts unconfirmed to test identity/readiness separation.
    const id = randomUUID();
    await pool.query(
      `INSERT INTO inventory.items(id,category_id,branch_id,name,brand,status,image_path,attributes,ai_visible_text,stock_quantity,stock_distribution_source,created_by,updated_by)
      VALUES($1,$2,$3,$4,$8,'needs-review','matching-test.jpg',$5,$6,1,'ai_suggested',$7,$7)`,
      [
        id,
        category,
        branch,
        `Suggestion fixture ${model}`,
        { size, style: model, color: "Blue", material: "Cotton", ...attributes },
        `Caption: ${model}`,
        actor,
        fixtureBrand,
      ],
    );
    await pool.query(
      `INSERT INTO inventory.item_variant_lines(id,item_id,position,variant_key,variant_attributes,quantity,updated_by)
      VALUES($1,$2,0,$3,$4,1,$5)`,
      [randomUUID(), id, size, { size }, actor],
    );
    if (inBatch)
      await pool.query(
        "INSERT INTO catalog_workspace.batch_items(batch_id,item_id,added_by) VALUES($1,$2,$3)",
        [batch, id, actor],
      );
    return id;
  }
  const scope = `/catalog-workspace/match-suggestions?batch_id=${batch}`;
  const review = (ids) =>
    call("/catalog-workspace/match-suggestions/review", { item_ids: ids, batch_id: batch });
  const decision = (candidate, extra = {}) => ({
    item_ids: candidate.members.map((row) => row.id),
    batch_id: batch,
    expected_revision: candidate.revision,
    product_name: `Reviewed ${candidate.model}`,
    brand_name: candidate.brand,
    confirm_identity: true,
    review_note: "Original labels verified",
    ...extra,
  });
  async function makeReady(ids) {
    // Commercial preparation is explicit and separate from identity confirmation.
    for (const id of ids) {
      await pool.query(
        "UPDATE inventory.items SET price=90000,stock_distribution_source='human_confirmed' WHERE id=$1",
        [id],
      );
      await pool.query(
        "INSERT INTO inventory.item_costs(item_id,cost_price,updated_by) VALUES($1,45000,$2) ON CONFLICT(item_id) DO UPDATE SET cost_price=45000",
        [id, actor],
      );
    }
  }
  try {
    token = (await call("/auth/login", { username: "testadmin", password: "testpass123" })).token;
    await pool.query(
      "INSERT INTO catalog_workspace.batches(id,branch_id,created_by,title) VALUES($1,$2,$3,$4)",
      [batch, branch, actor, "Suggested matching integration"],
    );
    const a = await seed("TEST-A01"),
      b = await seed("TEST-A01", "2XL");
    const c = await seed("TEST-A01", "L", { color: "Red" });
    await seed("TEST-A02");
    await seed("TEST-A02", "L", {}, false);
    const initial = await call(scope);
    assert.equal(initial.model_calls, 0);
    assert.equal(initial.suggestions.length, 1);
    assert.equal(initial.suggestions[0].state, "Check differences");
    assert.equal(initial.suggestions[0].counts.total_units, null);
    const excluded = await review([a, b]);
    assert.equal(excluded.state, "Same model code");
    assert.equal(excluded.members.length, 2);
    await call(
      "/catalog-workspace/match-suggestions/confirm",
      decision(initial.suggestions[0]),
      400,
    );
    await call("/catalog-workspace/match-suggestions/dismiss", decision(initial.suggestions[0]));
    assert.equal((await call(scope)).suggestions[0].dismissed, true);
    await pool.query("UPDATE inventory.items SET price=90000 WHERE id=$1", [a]);
    assert.equal((await call(scope)).suggestions[0].dismissed, true);
    await call("/catalog-workspace/match-suggestions/confirm", decision(excluded), 409);
    await call("/catalog-workspace/match-suggestions/restore", { id: initial.suggestions[0].id });
    assert.equal((await call(scope)).suggestions[0].dismissed, false);
    const fresh = await review([a, b]);
    const submissions = await Promise.all(
      [1, 2].map(async () => {
        const response = await fetch(base + "/catalog-workspace/match-suggestions/confirm", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Branch-Id": branch,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(decision(fresh)),
        });
        return { status: response.status, result: await response.json() };
      }),
    );
    assert.deepEqual(submissions.map((row) => row.status).sort(), [200, 409]);
    const plan = submissions.find((row) => row.status === 200).result;
    assert(plan.identity_review);
    assert.equal(plan.result_product_id, null);
    await call(`/catalog-workspace/product-matches/${plan.id}/review`, {}, 400);
    assert.equal((await call(scope)).suggestions.length, 0);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM inventory.catalog_publications WHERE item_id=ANY($1::uuid[])",
          [[a, b, c]],
        )
      ).rows[0].n,
      0,
    );
    await call(`/catalog-workspace/product-matches/${plan.id}/unmatch`, {
      expected_revision: plan.revision,
    });
    // A changed source identity invalidates both the saved dismissal and the signed confirmation.
    let changed = await review([a, b, c]);
    await call("/catalog-workspace/match-suggestions/dismiss", decision(changed));
    await pool.query(
      'UPDATE inventory.items SET attributes=attributes || \'{"color":"Navy"}\'::jsonb WHERE id=$1',
      [c],
    );
    assert.equal((await call(scope)).suggestions[0].dismissed, false);
    const materialA = await seed("TEST-M01"),
      materialB = await seed("TEST-M01", "L", { material: "Polyester" });
    const materialReview = await review([materialA, materialB]);
    await call(
      "/catalog-workspace/match-suggestions/confirm",
      decision(materialReview, { resolve_differences: true }),
      400,
    );
    const materialPlan = await call(
      "/catalog-workspace/match-suggestions/confirm",
      decision(materialReview, { resolve_differences: true, material: null }),
    );
    assert.equal(materialPlan.identity_review.material, null);
    const cashier = (
      await call("/auth/login", { username: "testcashier", password: "testpass123" })
    ).token;
    await call(scope, undefined, 403, cashier);
    const otherBranch = (
      await pool.query("SELECT id FROM branches WHERE id<>$1 AND status='active' LIMIT 1", [branch])
    ).rows[0]?.id;
    if (otherBranch)
      await call(
        "/catalog-workspace/match-suggestions/review",
        { item_ids: [a, b] },
        409,
        token,
        otherBranch,
      );
    const all = await call("/catalog-workspace/match-suggestions");
    assert(all.suggestions.some((row) => row.model === "TEST-A02"));
    // Verify cancelled evidence and manually confirmed codes with no remaining visible text.
    await pool.query(
      `INSERT INTO inventory.intake_cancellations(item_id,branch_id,cancelled_by,reason) VALUES($1,$2,$3,'Isolated test')`,
      [c, branch, actor],
    );
    assert.equal(
      (await call(scope)).suggestions.find((row) => row.model === "TEST-A01").members.length,
      2,
    );
    await pool.query("UPDATE inventory.items SET ai_visible_text='' WHERE id=$1", [a]);
    assert(!(await call(scope)).suggestions.some((row) => row.model === "TEST-A01"));
    await pool.query(
      `INSERT INTO inventory.item_events(item_id,event_type,source,field_path,after_value,actor,created_at) VALUES($1,'manual_edit','manual','attributes.style',$2,$3,now())`,
      [a, JSON.stringify("TEST-A01"), actor],
    );
    assert((await call(scope)).suggestions.some((row) => row.model === "TEST-A01"));
    await makeReady([materialA, materialB]);
    const receiveReview = await call(
      `/catalog-workspace/product-matches/${materialPlan.id}/review`,
      {},
    );
    assert.equal(receiveReview.total_units, 2);
    await pool.query(
      'UPDATE inventory.items SET attributes=attributes || \'{"color":"Red"}\'::jsonb WHERE id=$1',
      [materialA],
    );
    await call(
      `/catalog-workspace/product-matches/${materialPlan.id}/receive`,
      { expected_revision: receiveReview.revision },
      409,
    );
    await pool.query(
      'UPDATE inventory.items SET attributes=attributes || \'{"color":"Blue"}\'::jsonb WHERE id=$1',
      [materialA],
    );
    const receiveFresh = await call(
      `/catalog-workspace/product-matches/${materialPlan.id}/review`,
      {},
    );
    const received = await call(`/catalog-workspace/product-matches/${materialPlan.id}/receive`, {
      expected_revision: receiveFresh.revision,
    });
    assert.equal(
      (await pool.query("SELECT material FROM products WHERE id=$1", [received.product_id])).rows[0]
        .material,
      null,
    );
    assert.equal(
      (
        await call(`/catalog-workspace/product-matches/${materialPlan.id}/receive`, {
          expected_revision: receiveFresh.revision,
        })
      ).already_received,
      true,
    );
    const singleton = await seed("TEST-M01", "M");
    let targetReview = await review([singleton]);
    assert(targetReview.targets.some((target) => target.id === received.product_id));
    await call("/catalog-workspace/match-suggestions/confirm", decision(targetReview), 400);
    const targetPlan = await call(
      "/catalog-workspace/match-suggestions/confirm",
      decision(targetReview, { target_product_id: received.product_id, resolve_differences: true }),
    );
    assert.equal(targetPlan.target_product_id, received.product_id);
    await makeReady([singleton]);
    await call(`/catalog-workspace/product-matches/${targetPlan.id}/review`, {});
    const originalBrand = (
      await pool.query("SELECT brand_id FROM products WHERE id=$1", [received.product_id])
    ).rows[0].brand_id;
    await pool.query("UPDATE brands SET name=$2 WHERE id=$1", [
      originalBrand,
      `${fixtureBrand} changed`,
    ]);
    await call(`/catalog-workspace/product-matches/${targetPlan.id}/review`, {}, 409);
    await pool.query("UPDATE brands SET name=$2 WHERE id=$1", [originalBrand, fixtureBrand]);
    await call(`/catalog-workspace/product-matches/${targetPlan.id}/unmatch`, {
      expected_revision: targetPlan.revision,
    });
    const otherA = await seed("TEST-M01", "S"),
      otherB = await seed("TEST-M01", "2XL");
    await makeReady([otherA, otherB]);
    const secondPlan = await call(
      "/catalog-workspace/match-suggestions/confirm",
      decision(await review([otherA, otherB])),
    );
    const secondReview = await call(
      `/catalog-workspace/product-matches/${secondPlan.id}/review`,
      {},
    );
    const secondReceipt = await call(
      `/catalog-workspace/product-matches/${secondPlan.id}/receive`,
      { expected_revision: secondReview.revision },
    );
    targetReview = await review([singleton]);
    assert.equal(targetReview.targets.length, 2);
    await pool.query("UPDATE products SET is_active=false WHERE id=$1", [secondReceipt.product_id]);
    await call(
      "/catalog-workspace/match-suggestions/confirm",
      decision(targetReview, {
        target_product_id: secondReceipt.product_id,
        resolve_differences: true,
      }),
      400,
    );
    assert.equal((await review([singleton])).targets.length, 1);
    const report = {
      checked_at: new Date().toISOString(),
      passed: true,
      discovery_ms: initial.discovery_ms,
      branch_discovery_ms: all.discovery_ms,
      branch_eligible_lots: all.coverage.eligible_lots,
      checks: [
        "unready identity confirmation",
        "receipt blockers",
        "design conflicts",
        "exclusion recalculation",
        "persistent dismissal",
        "price does not restore dismissal",
        "identity does restore dismissal",
        "restore decision",
        "stale revision",
        "concurrent overlap",
        "material resolution",
        "permission checks",
        "cross-branch",
        "delivery scope",
        "cancelled source",
        "manual evidence",
        "material retained as unset in POS",
        "changed identity blocks receipt",
        "idempotent receipt",
        "eligible existing POS singleton",
        "multiple targets require choice",
        "inactive target invalidates review",
      ],
      model_calls: 0,
    };
    fs.writeFileSync(
      "verification/match-suggestions-integration.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(report);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}
verifySuggestions().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
