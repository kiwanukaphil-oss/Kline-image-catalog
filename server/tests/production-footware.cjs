/** Apply and verify the owner's approved shoe taxonomy through audited POS APIs. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(root, '.test-data/production-api-private.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(config.RAILWAY_PROJECT_ID, 'f06ae302-c116-487a-96d6-4a76a387e533');
const api = 'https://inventorypos-production.up.railway.app/api';
const parentId = '57155a81-0d84-4ab1-812c-4b6f997451a1';
const posParentId = 'a5239b63-473b-4821-afe6-703f95012774';
let token;

/** Send each mutation once; fail explicitly so interrupted runs can inspect state before retrying. */
async function callApi(route, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(api + route, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Branch-Id': 'd2622a5b-6397-47c7-9ee3-3d28bcec76c8',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  assert(response.ok, `${method} ${route}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}

const editableFields = (schema, id) => schema.fields.filter(field => field.category_id === id)
  .map(({ key, label, type, options, required, inherit }) => ({ key, label, type, options: options || [], required, inherit }));

/** Save against a fresh signed revision and retain every existing field key and type. */
async function saveDefinition(id, name, parent, transform) {
  const schema = await callApi('/catalog-workspace/schema');
  const fields = transform(editableFields(schema, id));
  await callApi(`/catalog-workspace/schema/${id}`, {
    name, parent_id: parent, fields, expected_revision: schema.revision,
  }, 'PUT');
}

/** Keep the existing parent, Formal Shoes and Sneakers identities while adding the two requested children. */
async function configureFootware() {
  token = (await callApi('/auth/login', { username: 'catalog_sync', password: config.CATALOG_SYNC_PASSWORD })).token;
  assert(token);
  let schema = await callApi('/catalog-workspace/schema');
  let pos = (await callApi('/categories')).data;
  const parent = schema.categories.find(category => category.id === parentId);
  assert(parent?.active && ['Footwear', 'Footware'].includes(parent.name));
  assert(pos.some(category => category.id === posParentId && category.is_active));
  const before = { schema, pos };
  console.log(JSON.stringify({ parent, children: schema.categories.filter(category => category.parent_id === parentId),
    fields: schema.fields.filter(field => field.category_id === parentId) }, null, 2));
  if (!process.argv.includes('--apply')) return;
  const backupPath = path.join(root, '.test-data/footware-before.json');
  if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, JSON.stringify(before, null, 2));
  await saveDefinition(parentId, 'Footware', null, fields => {
    // Removal candidates: inherited pattern/material and legacy child width/style/size_eu; retain as optional.
    const preserved = fields.map(field => ({ ...field, required: field.key === 'color' || field.key === 'size' }));
    if (!preserved.some(field => field.key === 'size')) preserved.push({
      key: 'size', label: 'Shoe size (as captioned)', type: 'text', options: [], required: true, inherit: true,
    });
    return preserved;
  });
  if (pos.find(category => category.id === posParentId).name !== 'Footware') {
    await callApi(`/categories/${posParentId}`, { name: 'Footware' }, 'PUT');
  }
  for (const name of ['Formal Shoes', 'Sneakers', 'Casual Shoes', 'Sandals']) {
    schema = await callApi('/catalog-workspace/schema');
    const matches = schema.categories.filter(category => category.active && category.name === name && category.parent_id === parentId);
    assert(matches.length <= 1);
    const id = matches[0]?.id || randomUUID();
    await saveDefinition(id, name, parentId, fields => fields.map(field => ({ ...field, required: false })));
    pos = (await callApi('/categories')).data;
    const destinations = pos.filter(category => category.is_active && category.name === name && category.parent_id === posParentId);
    assert(destinations.length <= 1);
    const destination = destinations[0] || (await callApi('/categories', { name, parent_id: posParentId, status: 'active' })).data;
    const mapping = (await callApi('/catalog-workspace/category-mappings')).categories.find(category => category.id === id);
    assert(mapping);
    if (mapping.pos_category_id !== destination.id) await callApi(`/catalog-workspace/category-mappings/${id}`, {
      pos_category_id: destination.id, expected_revision: mapping.revision,
    }, 'PUT');
  }
  schema = await callApi('/catalog-workspace/schema');
  const mappings = await callApi('/catalog-workspace/category-mappings');
  pos = (await callApi('/categories')).data;
  assert.equal(schema.categories.find(category => category.id === parentId).name, 'Footware');
  assert.equal(pos.find(category => category.id === posParentId).name, 'Footware');
  const parentFields = editableFields(schema, parentId);
  assert.deepEqual(parentFields.filter(field => field.required).map(field => field.key).sort(), ['color', 'size']);
  assert(parentFields.find(field => field.key === 'size').inherit);
  const children = schema.categories.filter(category => category.active && category.parent_id === parentId);
  for (const name of ['Formal Shoes', 'Sneakers', 'Casual Shoes', 'Sandals']) {
    const child = children.find(category => category.name === name);
    assert(child);
    assert(editableFields(schema, child.id).every(field => !field.required));
    const mapping = mappings.categories.find(category => category.id === child.id);
    assert(pos.some(category => category.id === mapping.pos_category_id && category.name === name && category.parent_id === posParentId && category.is_active));
  }
  for (const field of before.schema.fields) assert(schema.fields.some(current => current.id === field.id && current.key === field.key && current.type === field.type));
  const report = { checked_at: new Date().toISOString(), passed: true, parent: 'Footware', parent_id: parentId,
    children: children.map(({ id, name }) => ({ id, name })), required_category_fields: ['color', 'size'],
    size_label: 'Shoe size (as captioned)', inherited_size: true, existing_fields_preserved: true,
    pos_mappings_verified: true, caption_support: 'Existing AI reads captions and preserves exact sizes; canonical size field enables size distributions.' };
  fs.writeFileSync(path.join(root, 'verification/production-footware.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
configureFootware().catch(error => { console.error(error.message); process.exitCode = 1; });
