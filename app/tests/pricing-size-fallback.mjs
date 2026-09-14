import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { withPricingSize, withPricingPlanSizes, compileCombinedPriceProposal } from '../lib/pricing.ts';
import { filterPricingItems, emptyPricingFilters, resolveGroupExceptions } from '../lib/pricing-groups.ts';
const item = {
  id: 'jeans40',
  name: 'GAP Jeans - Blue',
  brand: 'GAP',
  image_url: null,
  attributes: { size: '40' },
  stock_distribution_source: 'intake_default',
  revision: 'a'.repeat(64),
  is_published: false,
  base_price: null,
  lines: [
    { id: 'stock-row', variant_attributes: {}, quantity: 1, effective_price: null, price_override: null },
  ],
};
const projected = withPricingSize(item);
assert.equal(projected.lines[0].variant_attributes.size, '40');
assert.deepEqual(item.lines[0].variant_attributes, {});
assert.equal(projected.revision, item.revision);
const visible = filterPricingItems([projected], { ...emptyPricingFilters, size: '40' }, 'retail', 'fill');
assert.equal(visible.length, 1);
const exceptions = resolveGroupExceptions(
  [projected],
  ['stock-row'],
  [{ id: 'size40', brand: '', size: '40', price: '110000' }],
  {},
);
const payload = compileCombinedPriceProposal(
  [projected],
  ['stock-row'],
  '90000',
  exceptions.exceptions,
  '',
  {},
  'fill',
);
assert.equal(payload.items[0].lines[0].id, 'stock-row');
assert.equal(payload.items[0].lines[0].price_override, 110000);
assert(!JSON.stringify(payload).includes('variant_attributes'));
for (const size of ['38-40', '38, 40', 'M/L', '2XXL'])
  assert.deepEqual(withPricingSize({ ...item, attributes: { size } }).lines[0].variant_attributes, {});
assert.equal(
  withPricingSize({ ...item, lines: [{ ...item.lines[0], variant_attributes: { size: '38' } }] }).lines[0]
    .variant_attributes.size,
  '38',
);
assert.deepEqual(
  withPricingSize({ ...item, stock_distribution_source: 'human_confirmed' }).lines[0].variant_attributes,
  {},
);
assert(
  withPricingSize({ ...item, lines: [item.lines[0], { ...item.lines[0], id: 'second' }] }).lines.every(
    (line) => !line.variant_attributes.size,
  ),
);
const plan = {
  id: 'plan',
  rows: [{ item_id: item.id, line_id: 'stock-row', variant_attributes: {}, price_after: 110000 }],
};
assert.equal(withPricingPlanSizes(plan, [projected]).rows[0].variant_attributes.size, '40');
assert.deepEqual(plan.rows[0].variant_attributes, {});
const checks = [
  'Single saved size 40 appears in pricing without stock mutation',
  'Size filters and exceptions target the original row ID',
  'Server price-review labels retain size 40',
  'Explicit and confirmed sizes, multi-size lots and ambiguous labels are preserved',
];
await fs.writeFile(
  '../verification/pricing-size-fallback.json',
  JSON.stringify({ passed: true, checks }, null, 2),
);
console.log(JSON.stringify({ passed: true, checks }));
