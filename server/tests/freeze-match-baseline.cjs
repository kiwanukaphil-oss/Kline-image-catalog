const fs = require("node:fs");
const path = require("node:path");

/** Freeze only relevant saved evidence and labelled expectations; never write to production or enrich extracted evidence from labels. */
function freezeBaseline() {
  const rows = JSON.parse(fs.readFileSync(".test-data/namugongo-items.json", "utf8"));
  const lines = JSON.parse(fs.readFileSync(".test-data/namugongo-readiness.json", "utf8")).lines;
  const review = JSON.parse(fs.readFileSync("verification/namugongo-product-matches.json", "utf8"));
  const items = rows.map((row, index) => ({
    id: String(index + 1).padStart(2, "0"),
    photo_number: index + 1,
    name: row.name,
    brand: row.brand,
    category_id: "formal-shirts",
    pos_category_id: "pos-shirts",
    attributes: row.attributes,
    ai_visible_text: row.ai_visible_text,
    ai_field_evidence: row.ai_field_evidence,
    stock_quantity: row.stock_quantity,
    stock_distribution_source: row.stock_distribution_source,
    variant_lines: lines
      .filter((line) => line.item_id === row.id)
      .map((line) => ({
        variant_attributes: line.variant_attributes,
        quantity: Number(line.quantity),
      })),
  }));
  const expected = review.groups.map((group) => ({
    model: group.model,
    brand: group.plan.brand_name,
    color: group.plan.variant_defaults.color,
    members: group.photo_numbers.map((number) => String(number).padStart(2, "0")),
    sizes: group.size_quantities,
  }));
  fs.mkdirSync(path.join(__dirname, "fixtures"), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, "fixtures/namugongo-match-evidence.json"),
    JSON.stringify(
      {
        provenance:
          "Saved pre-receipt evidence from 2026-09-08, paired with the independent 67-photo review. Expected labels are never copied into the extracted-evidence evaluation.",
        items,
        expected,
        expected_units: 126,
        expected_separate: 26,
      },
      null,
      2,
    ) + "\n",
  );
  console.log({
    lots: items.length,
    saved_units: items.reduce((n, row) => n + Number(row.stock_quantity), 0),
    style_fields: items.filter((row) => row.attributes?.style).length,
  });
}
freezeBaseline();
