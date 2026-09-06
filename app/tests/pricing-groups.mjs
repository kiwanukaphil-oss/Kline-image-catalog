import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { compilePriceProposal } from '../lib/pricing.ts';
import {
  emptyPricingFilters,
  filterPricingItems,
  resolveGroupExceptions,
  validateGroupExceptions,
  summarizePricePlan,
} from '../lib/pricing-groups.ts';

const checks = [];
const pass = (name) => {
  checks.push(name);
  console.log('PASS', name);
};
const makeItem = (index) => ({
  id: randomUUID(),
  name: `Formal shirt ${index}`,
  brand: 'Hugo Boss',
  category_id: 'shirts',
  category_name: 'Formal shirts',
  image_url: null,
  revision: 'a'.repeat(64),
  is_published: false,
  base_price: null,
  lines: ['M', 'L', 'XL'].map((size) => ({
    id: randomUUID(),
    variant_attributes: { size },
    quantity: 1,
    effective_price: null,
    price_override: null,
  })),
});
const items = Array.from({ length: 1000 }, (_, index) => makeItem(index));
const selected = items.flatMap((item) => item.lines.map((line) => line.id));
const sizeRule = [{ id: 'xl', brand: '', size: 'xl', price: '150000' }];
const resolved = resolveGroupExceptions(items, selected, sizeRule, {});
validateGroupExceptions(sizeRule, resolved);
const proposal = compilePriceProposal(items, selected, '100000', resolved.exceptions, 'retail', 'fill');
assert.equal(proposal.items.length, 1000);
assert.equal(
  proposal.items.reduce((sum, item) => sum + item.target_line_ids.length, 0),
  3000,
);
assert(
  proposal.items.every(
    (item) =>
      item.base_price === 100000 && item.lines.length === 1 && item.lines[0].price_override === 150000,
  ),
);
pass('1,000 Hugo Boss shirts: all 3,000 sizes selected, XL at 150,000 and others at 100,000');

const shorts = items.slice(0, 12).map((item, index) => ({
  ...item,
  name: `Shorts ${index}`,
  category_id: 'shorts',
  category_name: 'Shorts',
  brand: index < 4 ? 'H&M' : 'Hugo Boss',
}));
const matching = filterPricingItems(
  [...items, ...shorts],
  { ...emptyPricingFilters, category: 'shorts' },
  'retail',
  'fill',
);
assert.equal(matching.length, 12);
const shortIds = matching.flatMap((item) => item.lines.map((line) => line.id));
const brandRules = [{ id: 'hm', brand: 'h&m', size: '', price: '80000' }];
const brandResolved = resolveGroupExceptions(matching, shortIds, brandRules, {});
validateGroupExceptions(brandRules, brandResolved);
const shortsProposal = compilePriceProposal(
  matching,
  shortIds,
  '60000',
  brandResolved.exceptions,
  'retail',
  'fill',
);
assert.equal(
  shortsProposal.items.filter(
    (item) => item.lines.length === 3 && item.lines.every((line) => line.price_override === 80000),
  ).length,
  4,
);
assert.equal(
  shortsProposal.items.filter((item) => item.lines.length === 0 && item.base_price === 60000).length,
  8,
);
pass('All shorts share a price with every H&M size receiving the brand exception');

const overlapRules = [...brandRules, ...sizeRule];
const overlap = resolveGroupExceptions(matching, shortIds, overlapRules, {});
assert.equal(overlap.conflicts.length, 4);
assert.throws(() => validateGroupExceptions(overlapRules, overlap), /Conflicting exceptions/);
assert.deepEqual(
  resolveGroupExceptions(matching, shortIds, [...overlapRules].reverse(), {}).conflicts,
  overlap.conflicts,
);
pass('Conflicting exceptions are order independent and block review');
const filtered = filterPricingItems(
  items,
  { ...emptyPricingFilters, brand: 'hugo boss', search: 'shirt formal' },
  'retail',
  'fill',
);
assert.equal(filtered.length, 1000);
assert.equal(
  filterPricingItems(items, { ...emptyPricingFilters, brand: 'boss' }, 'retail', 'fill').length,
  0,
);
assert.equal(
  filterPricingItems(
    items.map((item) => ({
      ...item,
      lines: item.lines.map((line) => ({ ...line, effective_price: 100000 })),
    })),
    emptyPricingFilters,
    'retail',
    'fill',
  ).length,
  0,
);
pass('Exact brand filters, word search and missing-price eligibility avoid unintended matches');
const subset = [items[0].lines[2].id];
const partial = compilePriceProposal(items, subset, '150000', {}, 'retail', 'fill');
assert(!Object.hasOwn(partial.items[0], 'base_price'));
assert.equal(partial.items[0].lines[0].price_override, 150000);
pass('Selecting XL alone never changes the unselected size defaults');

const rows = items.flatMap((item) =>
  item.lines.map((line) => ({
    item_id: item.id,
    line_id: line.id,
    quantity: line.quantity,
    price_after: line.variant_attributes.size === 'XL' ? 150000 : 100000,
    changed: true,
  })),
);
assert.deepEqual(
  summarizePricePlan({ rows }, 'retail').map((group) => [group.price, group.sizes, group.units]),
  [
    [100000, 2000, 2000],
    [150000, 1000, 1000],
  ],
);
pass('3,000 exact review rows collapse into two accurate price groups');
await fs.writeFile(
  new URL('../../verification/pricing-groups.json', import.meta.url),
  JSON.stringify(
    {
      passed: true,
      checked_at: new Date().toISOString(),
      scope: 'Group selection and proposal compilation; real POS integration reported separately.',
      checks,
    },
    null,
    2,
  ),
);
