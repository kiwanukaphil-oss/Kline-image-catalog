const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  discoverCandidates,
  modelEvidence,
  identityOf,
  fingerprint,
} = require("../match-candidates.cjs");
const fixture = require("./fixtures/namugongo-match-evidence.json");

/** Evaluate extraction coverage separately from exact-matching behavior on independently reviewed identities. */
function verifyBaseline() {
  const extracted = discoverCandidates(fixture.items);
  const expectedKeys = new Set(fixture.expected.map((row) => row.members.slice().sort().join(",")));
  const trueMatches = extracted.filter((row) =>
    expectedKeys.has(row.members.map((item) => item.id).join(",")),
  );
  const correctPartial = extracted.filter((row) =>
    fixture.expected.some((group) => row.members.every((item) => group.members.includes(item.id))),
  );
  const correctEvidence = structuredClone(fixture.items);
  // This is an explicit ideal-extraction regression, never a claim that today's extractor read all these codes.
  // Known distinct codes remain represented among separate lots. Obscured/no-code labels remain unavailable.
  for (const number of [15, 19, 20, 21, 22, 46, 47]) {
    const item = correctEvidence[number - 1];
    item.attributes.style = "";
    item.ai_visible_text = "";
    item.ai_field_evidence = {};
  }
  for (const [number, code] of [
    [16, "26201B-16"],
    [17, "26201A-14"],
    [26, "26201A-12"],
    [33, "26201A-10"],
    [35, "26201B-14"],
    [40, "0663-29"],
  ]) {
    correctEvidence[number - 1].attributes.style = code;
    correctEvidence[number - 1].ai_visible_text = `Printed model ${code}`;
  }
  for (const group of fixture.expected)
    for (const item of correctEvidence.filter((row) => group.members.includes(row.id))) {
      Object.assign(item.attributes, {
        style: group.model,
        color: group.color,
        pattern: "Reviewed identical design",
        fit: "Slim",
        sleeve: "Long",
        material: "Fixture material",
      });
      item.brand = group.brand;
      item.ai_visible_text = `Printed model ${group.model}`;
    }
  const ideal = discoverCandidates(correctEvidence);
  assert.equal(ideal.length, 12);
  assert.equal(
    ideal.reduce((n, row) => n + row.members.length, 0),
    41,
  );
  assert(
    ideal.every(
      (row) =>
        row.state === "Same model code" &&
        expectedKeys.has(row.members.map((item) => item.id).join(",")),
    ),
  );
  assert.equal(
    fixture.items.reduce((n, row) => n + Number(row.stock_quantity), 0),
    126,
  );
  for (const code of ["26201B-25", "D9663-2A"]) {
    const group = ideal.find((row) => row.model === code);
    assert.equal(
      group.counts.rows
        .filter((row) => row.attributes.size === "XL")
        .reduce((n, row) => n + row.quantity, 0),
      2,
    );
  }
  const report = {
    baseline_lots: 67,
    units: 126,
    ideal: { groups: ideal.length, grouped_lots: 41, separate_lots: 26, precision: 1, recall: 1 },
    saved_extraction: {
      evidence_lots: fixture.items.filter(modelEvidence).length,
      candidates: extracted.length,
      exact_reference_groups: trueMatches.length,
      recall: trueMatches.length / 12,
      correct_partial_groups: correctPartial.length,
      candidate_member_precision: extracted.length
        ? correctPartial.length / extracted.length
        : null,
      candidate_members: correctPartial.reduce((sum, row) => sum + row.members.length, 0),
      standard_false_candidates: extracted.filter(
        (row) =>
          row.state === "Same model code" &&
          !expectedKeys.has(row.members.map((item) => item.id).join(",")),
      ).length,
      missing_reference_groups: fixture.expected
        .filter(
          (row) =>
            !trueMatches.some(
              (match) => match.members.map((item) => item.id).join(",") === row.members.join(","),
            ),
        )
        .map((row) => row.model),
    },
    model_calls: 0,
  };
  fs.writeFileSync(
    "verification/match-candidate-baseline.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
}

/** Exercise adversarial suffixes, conflicting designs, normalization and count/dismissal invariants. */
function verifyBoundaries() {
  const lot = (id, model, attributes = {}) => ({
    id,
    category_id: "shirts",
    pos_category_id: "shirts",
    brand: "Brand",
    comparison_fields: ["color", "material"],
    attributes: { style: model, color: "Blue", material: "Cotton", ...attributes },
    ai_visible_text: `Model ${model}`,
    stock_quantity: 1,
    stock_distribution_source: "human_confirmed",
    variant_lines: [{ variant_attributes: { size: "XL" }, quantity: 1 }],
  });
  for (const [left, right] of [
    ["26201B-16", "26201B-26"],
    ["26201A-14", "26201B-14"],
    ["0663-29", "0663-11"],
    ["0663-11", "663-11"],
    ["A01", "A0I"],
    ["A01", "AO1"],
    ["A 01", "A01"],
  ])
    assert.equal(discoverCandidates([lot("a", left), lot("b", right)]).length, 0);
  const a = lot("a", "26201A-1"),
    b = lot("b", "26201A-1");
  for (const text of ["26201A-11", "26201A-1-?", "26201A-1A", "26201A-?"])
    assert.equal(modelEvidence({ ...a, ai_visible_text: text }), null);
  assert.equal(
    modelEvidence({
      ...a,
      ai_visible_text: "",
      ai_field_evidence: { style: { source: "visual_inference", observation: "26201A-1" } },
    }),
    null,
  );
  assert(modelEvidence({ ...a, ai_visible_text: "", staff_model_confirmed: true }));
  assert.equal(discoverCandidates([a, { ...b, brand: "Other brand" }]).length, 0);
  assert.equal(discoverCandidates([a, { ...b, category_id: "pants" }]).length, 0);
  assert.equal(
    discoverCandidates([
      a,
      { ...b, brand: " brand ", attributes: { ...b.attributes, style: " 26201a-1 " } },
    ]).length,
    1,
  );
  const bridge = discoverCandidates([
    a,
    lot("b", "26201A-1", { color: "" }),
    lot("c", "26201A-1", { color: "Red" }),
  ]);
  assert.equal(bridge.length, 1);
  assert.equal(bridge[0].state, "Check differences");
  assert(bridge[0].issues.some((issue) => issue.field === "color" && issue.kind === "conflict"));
  assert.equal(
    discoverCandidates([a, { ...b, stock_distribution_source: "ai_suggested" }])[0].counts
      .total_units,
    null,
  );
  assert.equal(discoverCandidates([a, { ...b, stock_quantity: 2 }])[0].counts.total_units, null);
  assert.equal(
    discoverCandidates([a, lot("b", "26201A-1", { color: "Unknown" })])[0].state,
    "Check differences",
  );
  assert.equal(modelEvidence(lot("size", "2XL", { size: "2XL" })), null);
  assert.equal(
    discoverCandidates([{ ...a, comparison_fields: ["color", "pattern"] }, b])[0].state,
    "Check differences",
  );
  const identity = fingerprint([a, b].map(identityOf));
  assert.equal(
    identity,
    fingerprint([{ ...a, price: 1000, stock_quantity: 2 }, b].map(identityOf)),
  );
  assert.notEqual(identity, fingerprint([a, lot("b", "26201A-2")].map(identityOf)));
}
verifyBoundaries();
console.log(JSON.stringify(verifyBaseline(), null, 2));
