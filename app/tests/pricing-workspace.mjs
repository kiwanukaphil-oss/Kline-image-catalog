import assert from 'node:assert/strict';
import { loadPricingWorkspace } from '../lib/pricing-workspace.ts';

let running = 0,
  maximum = 0;
const visited = [];
// Resolve pages out of order and prove complete, ordered results with bounded concurrent requests.
const items = await loadPricingWorkspace(
  [],
  async ({ page }) => {
    visited.push(page);
    running++;
    maximum = Math.max(maximum, running);
    await new Promise((resolve) => setTimeout(resolve, page % 2 ? 8 : 20));
    running--;
    return { items: [{ id: String(page) }], total: 8, limit: 1 };
  },
  () => true,
);
assert.equal(maximum, 3);
assert.deepEqual(
  items.map((item) => item.id),
  ['1', '2', '3', '4', '5', '6', '7', '8'],
);
assert.equal(new Set(visited).size, 8);
let active = true;
const abandoned = [];
const cancelled = await loadPricingWorkspace(
  [],
  async ({ page }) => {
    abandoned.push(page);
    if (page > 1) active = false;
    return { items: [{ id: String(page) }], total: 20, limit: 1 };
  },
  () => active,
);
assert.deepEqual(cancelled, []);
assert.deepEqual(abandoned, [1, 2, 3, 4]);
await assert.rejects(
  () =>
    loadPricingWorkspace(
      [],
      async ({ page }) => {
        if (page === 3) throw new Error('Page unavailable');
        return { items: [{ id: String(page) }], total: 8, limit: 1 };
      },
      () => true,
    ),
  /Page unavailable/,
);
const scoped = await loadPricingWorkspace(
  ['selected-id'],
  async (body) => {
    assert.deepEqual(body, { item_ids: ['selected-id'] });
    return { items: [{ id: 'selected-id' }], total: 2000, limit: 1 };
  },
  () => true,
);
assert.deepEqual(scoped, [{ id: 'selected-id' }]);
console.log(
  'PASS ordered complete pricing pages, three-read limit, cancellation, failure and explicit scope',
);
