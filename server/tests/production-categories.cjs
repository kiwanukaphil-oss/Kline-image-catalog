/** Apply the owner's approved category additions through the existing POS API and integration account. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(root, '.test-data/production-api-private.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(config.RAILWAY_PROJECT_ID, 'f06ae302-c116-487a-96d6-4a76a387e533');
assert.equal(config.RAILWAY_SERVICE_ID, '16a1ac8a-2114-4107-8066-26fb699c1641');
const api = 'https://inventorypos-production.up.railway.app/api';

async function createApprovedCategories() {
  // Never change archived categories; locate the sole active Pants parent and reuse existing active children.
  const login = await fetch(`${api}/auth/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'catalog_sync', password: config.CATALOG_SYNC_PASSWORD }),
    signal: AbortSignal.timeout(20000) });
  assert.equal(login.status, 200);
  const session = await login.json();
  assert(session.token);
  const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
  const listed = await fetch(`${api}/categories`, { headers, signal: AbortSignal.timeout(20000) });
  assert.equal(listed.status, 200);
  const categories = (await listed.json()).data;
  const parents = categories.filter((row) => row.name === 'Pants' && row.is_active === true);
  assert.equal(parents.length, 1, 'Choose an unambiguous active Pants category');
  const parent = parents[0];
  const relevant = categories.filter((row) => ['Pants', 'Clothing', 'Shorts', 'Jeans', 'Sweat pants'].includes(row.name))
    .map(({ id, name, parent_id, status, is_active }) => ({ id, name, parent_id, status, is_active }));
  console.log(JSON.stringify({ active_categories: relevant }, null, 2));
  if (!process.argv.includes('--apply')) return;
  const outcomes = [];
  for (const name of ['Jeans', 'Sweat pants']) {
    const existing = categories.filter((row) => row.name === name && row.parent_id === parent.id && row.is_active);
    assert(existing.length <= 1);
    if (existing.length) { outcomes.push({ id: existing[0].id, name, created: false }); continue; }
    const response = await fetch(`${api}/categories`, { method: 'POST', headers,
      body: JSON.stringify({ name, parent_id: parent.id, status: 'active' }), signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 201, 'Inspect categories before retrying a failed create');
    const result = (await response.json()).data;
    assert.equal(result.name, name);
    assert.equal(result.parent_id, parent.id);
    outcomes.push({ id: result.id, name, created: true });
  }
  const report = { checked_at: new Date().toISOString(), actor: 'existing catalog_sync integration account',
    owner_approved: true, active_parent_id: parent.id, categories: outcomes, archived_categories_modified: false };
  fs.writeFileSync(path.join(root, 'verification/production-category-creation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
createApprovedCategories().catch((error) => { console.error(error.message); process.exitCode = 1; });
