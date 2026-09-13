const { createHash } = require("node:crypto");
const { canonicalCatalogSize } = require("./host-integration/catalogExtractionPolicy.cjs");
const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const comparisonFields = ["color", "pattern", "fit", "sleeve", "material"];
const comparisonValue = (value) =>
  /^(unknown|unspecified|not visible|not known|n\/a|none)$/i.test(normalizeText(value))
    ? ""
    : normalizeText(value);
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Require a whole printed code; substrings, damaged suffixes and inferred product names are insufficient. */
function modelEvidence(item) {
  const code = normalizeCode(item.attributes?.style);
  if (!code || !/\d/.test(code) || !/^[a-z0-9][a-z0-9 ._/-]*[a-z0-9]$/i.test(code)) return null;
  if (item.staff_model_confirmed)
    return { source: "Staff-confirmed code", text: String(item.attributes.style) };
  if (
    code === normalizeCode(item.attributes?.size) ||
    item.variant_lines?.some((line) => code === normalizeCode(line.variant_attributes?.size))
  )
    return null;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Hyphens and punctuation belong to model identity. Do not match A-1 inside A-11 or A-1-?.
  const complete = new RegExp(`(^|[^a-z0-9._/?-])${escaped}(?=$|[^a-z0-9._/?-])`, "i");
  if (complete.test(String(item.ai_visible_text || "")))
    return { source: "Saved caption/label text", text: item.ai_visible_text };
  const evidence = item.ai_field_evidence?.style;
  if (
    ["printed_label", "visible_text", "caption"].includes(evidence?.source) &&
    complete.test(evidence.observation)
  )
    return { source: evidence.source, text: evidence.observation };
  return null;
}

/** Fingerprint identity only, so price/count edits do not undo a deliberate keep-separate decision. */
function identityOf(item) {
  return {
    id: item.id,
    category_id: item.category_id,
    pos_category_id: item.pos_category_id,
    brand: normalizeText(item.brand),
    model: normalizeCode(item.attributes?.style),
    design: comparisonFields.map((key) => comparisonValue(item.attributes?.[key])),
    evidence: modelEvidence(item),
  };
}

/** Compare every member against the whole group; missing values never bridge contradictory designs. */
function compareMembers(members) {
  const issues = [];
  for (const key of comparisonFields) {
    const values = members.map((item) => comparisonValue(item.attributes?.[key]));
    const known = [...new Set(values.filter(Boolean))];
    if (known.length > 1)
      issues.push({
        field: key,
        kind: "conflict",
        message: `${key}: conflicting saved values (${known.join(" / ")}).`,
      });
    else if (
      values.some((value) => !value) &&
      (members.some((item) => (item.comparison_fields || comparisonFields).includes(key)) ||
        known.length)
    )
      issues.push({
        field: key,
        kind: "missing",
        message: `${key}: evidence is missing for some lots.`,
      });
  }
  if (members.some((item) => !item.pos_category_id))
    issues.push({
      field: "category",
      kind: "missing",
      message: "Map this category to POS before receiving.",
    });
  return issues;
}

/** Summarize saved counts, preserving size aliases without treating a photograph as one physical unit. */
function summarizeCounts(members) {
  const confirmed = members.every(
    (item) =>
      item.stock_distribution_source === "human_confirmed" &&
      item.variant_lines?.length &&
      item.variant_lines.every(
        (line) => Number.isSafeInteger(Number(line.quantity)) && Number(line.quantity) > 0,
      ) &&
      item.variant_lines.reduce((sum, line) => sum + Number(line.quantity), 0) ===
        Number(item.stock_quantity),
  );
  const totals = new Map();
  for (const item of members)
    for (const line of item.variant_lines || []) {
      let size = normalizeText(
        line.variant_attributes?.size || item.attributes?.size || "Size not recorded",
      );
      size = canonicalCatalogSize(size).toLowerCase();
      const key = JSON.stringify(
        Object.fromEntries(
          Object.entries({ ...line.variant_attributes, size: size.toUpperCase() }).sort(
            ([a], [b]) => a.localeCompare(b),
          ),
        ),
      );
      totals.set(key, (totals.get(key) || 0) + Number(line.quantity || 0));
    }
  return {
    confirmed,
    total_units: confirmed
      ? members.reduce((sum, item) => sum + Number(item.stock_quantity || 0), 0)
      : null,
    rows: [...totals].map(([key, quantity]) => ({ attributes: JSON.parse(key), quantity })),
  };
}

/** Build deterministic exact-code buckets from saved evidence; discovery performs no model calls or writes. */
function discoverCandidates(items, targets = [], allowSingle = false) {
  const buckets = new Map();
  for (const item of items) {
    if (!item.brand || !modelEvidence(item)) continue;
    const key = JSON.stringify([
      item.category_id,
      normalizeText(item.brand),
      normalizeCode(item.attributes?.style),
    ]);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  const candidates = [];
  for (const members of buckets.values()) {
    members.sort((a, b) => a.id.localeCompare(b.id));
    const first = members[0];
    const eligibleTargets = targets.filter(
      (target) =>
        target.pos_category_id === first.pos_category_id &&
        normalizeText(target.brand) === normalizeText(first.brand) &&
        normalizeCode(target.attributes?.style) === normalizeCode(first.attributes?.style) &&
        modelEvidence(target),
    );
    if (members.length < 2 && !eligibleTargets.length && !allowSingle) continue;
    const issues = compareMembers(members);
    const identity = members.map(identityOf);
    candidates.push({
      id: fingerprint(identity),
      brand: first.brand,
      model: first.attributes.style,
      category_id: first.category_id,
      category_path: first.category_path,
      members,
      issues,
      state:
        issues.length ||
        (members.length === 1 &&
          !eligibleTargets.some(
            (target) =>
              !compareMembers([...members, target]).length && !target.linked_issues?.length,
          ))
          ? "Check differences"
          : "Same model code",
      targets: eligibleTargets,
      counts: summarizeCounts(members),
    });
  }
  return candidates.sort((a, b) => a.id.localeCompare(b.id));
}
module.exports = {
  discoverCandidates,
  compareMembers,
  summarizeCounts,
  identityOf,
  fingerprint,
  modelEvidence,
  normalizeText,
};
