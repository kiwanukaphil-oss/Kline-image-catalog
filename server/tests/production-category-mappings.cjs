/** Read-only live catalog inventory; detailed reports stay in ignored local evidence. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const requirePos = createRequire('C:/Projects/Inventory POS release check/backend/package.json');
const { Pool } = requirePos('pg');
const root = path.resolve(__dirname, '../..');
const readPrivate = (name) => JSON.parse(fs.readFileSync(path.join(root, '.test-data', name), 'utf8').replace(/^\uFEFF/, ''));
const db = readPrivate('production-db-private.json');
assert.equal(db.RAILWAY_PROJECT_ID, 'f06ae302-c116-487a-96d6-4a76a387e533');
assert.equal(db.RAILWAY_ENVIRONMENT_ID, '87667cac-e089-45e8-b67d-2c5d0d25b9a8');
assert.equal(db.RAILWAY_SERVICE_ID, '26829259-55d6-447c-89bf-0474e71edc1f');
const pool = new Pool({ host: 'autorack.proxy.rlwy.net', port: 10669,
  database: db.PGDATABASE, user: db.PGUSER, password: db.PGPASSWORD,
  ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 45000,
  statement_timeout: 30000, options: '-c default_transaction_read_only=on' });

async function verifyApprovedCategoryMappings() {
  // Check approved destinations and fingerprint all original POS categories, excluding only our two additions.
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const created = JSON.parse(fs.readFileSync(path.join(root, 'verification/production-category-creation.json'), 'utf8'));
    const expected = [...created.categories, { name: 'Shorts', id: '9addde8b-a374-4b83-81a6-1b719d35f5b4' }];
    const mappings = (await client.query(`SELECT c.id AS catalog_category_id,c.name,m.pos_category_id,p.status,p.is_active,p.parent_id
      FROM inventory.categories c LEFT JOIN inventory.pos_category_map m ON m.image_category_id=c.id
      LEFT JOIN public.categories p ON p.id=m.pos_category_id WHERE c.active ORDER BY c.name`)).rows;
    assert.equal(mappings.length, 25);
    assert(mappings.every(row => row.pos_category_id && row.is_active && row.status === 'active'));
    for (const destination of expected) {
      const matches = mappings.filter(row => row.name === destination.name);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].pos_category_id, destination.id);
      if (destination.name !== 'Shorts') assert.equal(matches[0].parent_id, created.active_parent_id);
    }
    const backup = readPrivate('production-backup.json');
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(backup.backup), 'source-manifest.json'), 'utf8'));
    const baseline = manifest.tables.find(row => row.table_name === '\"public\".\"categories\"');
    assert(baseline);
    const current = (await client.query(`SELECT count(*)::int AS rows,
      md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) AS fingerprint
      FROM (SELECT md5(row_to_json(t)::text) AS row_hash FROM public.categories t WHERE NOT(id=ANY($1::uuid[]))) original_rows`,
      [created.categories.map(row => row.id)])).rows[0];
    assert.equal(current.rows, baseline.rows);
    assert.equal(current.fingerprint, baseline.fingerprint);
    await client.query('COMMIT');
    const report = { checked_at: new Date().toISOString(), passed: true, read_only: true,
      active_catalog_categories: mappings.length, unmapped_or_inactive_destinations: 0,
      approved_mappings: mappings.filter(row => expected.some(destination => destination.name === row.name)),
      original_pos_categories: current.rows, original_categories_unchanged: true, archived_categories_preserved: true };
    fs.writeFileSync(path.join(root, 'verification/production-category-mappings.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { client.release(); await pool.end(); }
}
verifyApprovedCategoryMappings().catch(error => { console.error(error.message); process.exitCode = 1; });
