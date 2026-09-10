import assert from 'node:assert/strict';
import { summarizeReceivingProducts, describeReceivingProducts } from '../lib/receiving-product-summary.ts';

const lots = Array.from({ length: 27 }, (_, index) => ({
  id: String(index),
  stock_quantity: index === 0 ? 19 : 1,
  stock_distribution_source: 'human_confirmed',
}));
const groupSizes = [4, 2, 3, 3, 4, 2, 2, 2, 2];
let offset = 0;
const groups = groupSizes.map((size, index) => {
  const item_ids = lots.slice(offset, offset + size).map((item) => item.id);
  offset += size;
  return { id: String(index), item_ids, target_product_id: null };
});
const complete = summarizeReceivingProducts(lots, groups);
assert.deepEqual(complete, {
  sourceLots: 27,
  products: 12,
  matchedGroups: 9,
  separateLots: 3,
  partialGroups: 0,
  units: 45,
  confirmed: true,
});
assert.equal(describeReceivingProducts(complete), '27 source lots → 12 POS products · 45 confirmed units');
const partial = summarizeReceivingProducts([lots[0], lots[0], lots[26]], groups);
assert.equal(partial.sourceLots, 2);
assert.equal(partial.products, 2);
assert.equal(partial.partialGroups, 1);
assert.equal(partial.units, 20);
const restockGroups = groups
  .slice(0, 2)
  .map((group) => ({ ...group, target_product_id: 'same-existing-product' }));
assert.equal(summarizeReceivingProducts(lots.slice(0, 6), restockGroups).products, 1);
assert.equal(
  summarizeReceivingProducts([{ ...lots[0], stock_distribution_source: 'ai_suggested' }], []).confirmed,
  false,
);
assert.deepEqual(summarizeReceivingProducts([], groups), {
  sourceLots: 0,
  products: 0,
  matchedGroups: 0,
  separateLots: 0,
  partialGroups: 0,
  units: 0,
  confirmed: false,
});
console.log('PASS source lots, product destinations, partial groups, duplicate rows and count confidence');
