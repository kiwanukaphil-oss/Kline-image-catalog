const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { configureTestEnvironment } = require("./environment.cjs");

/** Seed real photo copies in the dedicated local database for desktop/mobile review, never production. */
async function seedPreview() {
  const dependencies = configureTestEnvironment(),
    { pool } = dependencies.source("config/database");
  const branch = "00000000-0000-4000-b111-000000000001";
  try {
    if (process.argv.includes("--ready")) {
      const saved = JSON.parse(fs.readFileSync(".test-data/match-preview.json", "utf8"));
      const incoming = (
        await pool.query(
          "SELECT id FROM inventory.items WHERE id=ANY($1::uuid[]) AND pos_product_id IS NULL",
          [saved.item_ids],
        )
      ).rows;
      for (const { id } of incoming) {
        await pool.query(
          "UPDATE inventory.items SET stock_distribution_source='human_confirmed',price=90000 WHERE id=$1",
          [id],
        );
        await pool.query(
          "INSERT INTO inventory.item_costs(item_id,cost_price,updated_by) VALUES($1,45000,$2) ON CONFLICT(item_id) DO UPDATE SET cost_price=45000",
          [id, saved.actor],
        );
      }
      return;
    }
    const actor = (await pool.query("SELECT id FROM users WHERE username='testadmin'")).rows[0].id;
    const category = "d1000000-0000-4000-8000-000000000004";
    const mapping = (
      await pool.query("SELECT pos_category_id FROM inventory.pos_category_map LIMIT 1")
    ).rows[0];
    await pool.query(
      `INSERT INTO inventory.pos_category_map(id,image_category_id,pos_category_id,created_at,updated_at) VALUES($1,$2,$3,now(),now()) ON CONFLICT(image_category_id) DO NOTHING`,
      [randomUUID(), category, mapping.pos_category_id],
    );
    const batch = randomUUID(),
      ids = [];
    await pool.query(
      "INSERT INTO catalog_workspace.batches(id,branch_id,created_by,title) VALUES($1,$2,$3,$4)",
      [batch, branch, actor, "Model matching review — local fixture"],
    );
    const fixture = require("./fixtures/namugongo-match-evidence.json");
    for (const number of [8, 9, 10, 11, 12, 13, 41, 42]) {
      const source = fixture.items[number - 1],
        id = randomUUID(),
        photo = `suggestions-${number}.jpg`;
      fs.copyFileSync(`.test-data/namugongo-photos/${number}.jpg`, `.test-data/images/${photo}`);
      const style = number < 40 ? "26201A-6" : "0663-11",
        brand = number < 40 ? "Mack Weldon" : "Tommy Dolby";
      const attrs = {
        size: source.variant_lines[0].variant_attributes.size,
        style,
        color: "Light blue",
        material: number === 42 ? "Synthetic blend" : "Cotton",
        pattern: "Plain",
        fit: "Slim",
        sleeve: "Long",
      };
      await pool.query(
        `INSERT INTO inventory.items(id,category_id,branch_id,name,brand,status,image_path,attributes,ai_visible_text,stock_quantity,stock_distribution_source,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,'needs-review',$6,$7,$8,1,'ai_suggested',$9,$9)`,
        [
          id,
          category,
          branch,
          `${brand} ${style} ${attrs.size}`,
          brand,
          photo,
          attrs,
          `Model ${style}; size ${attrs.size}`,
          actor,
        ],
      );
      await pool.query(
        "INSERT INTO catalog_workspace.batch_items(batch_id,item_id,added_by) VALUES($1,$2,$3)",
        [batch, id, actor],
      );
      await pool.query(
        `INSERT INTO inventory.item_variant_lines(id,item_id,position,variant_key,variant_attributes,quantity,updated_by) VALUES($1,$2,0,$3,$4,1,$5)`,
        [randomUUID(), id, attrs.size, { size: attrs.size }, actor],
      );
      ids.push(id);
    }
    fs.writeFileSync(
      ".test-data/match-preview.json",
      JSON.stringify({ batch, actor, item_ids: ids }),
    );
    console.log({ batch, lots: ids.length });
  } finally {
    await pool.end();
  }
}
seedPreview().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
