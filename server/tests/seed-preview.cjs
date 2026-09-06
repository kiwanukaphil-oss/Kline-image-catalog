const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

/** Seed an editable arrival through real local APIs so the review workspace has unfinished work to explore. */
async function seedPreviewDelivery() {
  const base = 'http://127.0.0.1:5109/api';
  const login = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testadmin', password: 'testpass123' }),
  }).then((response) => response.json());
  if (!login.token) throw new Error('Start the dedicated local preview host first.');
  const branch = login.user.default_branch_id;
  async function call(route, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(base + route, {
      method,
      headers: {
        Authorization: `Bearer ${login.token}`,
        'X-Branch-Id': branch,
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    return result;
  }
  const existing = await call('/catalog-workspace/batches');
  if (existing.some((batch) => batch.title === 'New arrivals')) return;
  const batchId = randomUUID(),
    categoryId = '00000000-0000-4000-0300-000000000001';
  await call('/catalog-workspace/batches', { id: batchId, title: 'New arrivals' });
  const names = ['Pleated trousers', 'Straight-leg trousers', 'Cotton chinos'];
  for (let index = 0; index < 3; index++) {
    const id = randomUUID(),
      bytes = await fs.readFile(path.join(__dirname, `../../design/assets/item-${index}.jpg`));
    const form = new FormData();
    form.set('id', id);
    form.set('category_id', categoryId);
    form.set('status', 'draft');
    form.set('image', new Blob([bytes], { type: 'image/jpeg' }), `arrival-${index}.jpg`);
    await call('/catalog/items', form);
    await call(`/catalog-workspace/batches/${batchId}/items/${id}`, null, 'PUT');
    let detail = await call(`/catalog-workspace/items/${id}`);
    await call(
      `/catalog-workspace/items/${id}`,
      {
        expected_revision: detail.revision,
        name: names[index],
        brand: 'K-Line',
        category_id: categoryId,
        attributes: { material: 'Cotton' },
      },
      'PATCH',
    );
    detail = await call(`/catalog-workspace/items/${id}`);
    await call(
      `/catalog-workspace/items/${id}/count`,
      {
        expected_revision: detail.revision,
        entries: [
          { variant_attributes: { size: '30' }, quantity: 1 },
          { variant_attributes: { size: '32' }, quantity: 2 },
          { variant_attributes: { size: '34' }, quantity: index + 1 },
        ],
      },
      'PATCH',
    );
  }
  console.log('New arrivals are ready to explore in Receiving and Pricing.');
}
seedPreviewDelivery().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
