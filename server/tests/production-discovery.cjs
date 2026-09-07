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
  ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 15000,
  statement_timeout: 30000, options: '-c default_transaction_read_only=on' });
const quoteIdentifier = (name) => '"' + name.replaceAll('"', '""') + '"';

async function inspectProductionCatalog() {
  // One consistent read-only snapshot prevents mixing counts from concurrent intake writes.
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await client.query('SELECT current_database() AS database, current_setting(\'transaction_read_only\') AS read_only, version() AS version')).rows[0];
    const columns = (await client.query("SELECT table_schema,table_name,column_name,data_type FROM information_schema.columns WHERE table_schema IN ('inventory','catalog_workspace') OR (table_schema='public' AND table_name IN ('schema_migrations','branches','products','product_variants','users','user_branches','product_images')) ORDER BY table_schema,table_name,ordinal_position")).rows;
    const tables = [...new Set(columns.map((row) => `${quoteIdentifier(row.table_schema)}.${quoteIdentifier(row.table_name)}`))];
    const counts = {};
    for (const table of tables) counts[table] = Number((await client.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
    const statuses = (await client.query("SELECT status,pos_sync_status,count(*)::int AS count FROM inventory.items GROUP BY status,pos_sync_status ORDER BY status,pos_sync_status")).rows;
    const integrity = (await client.query(`SELECT
      (SELECT count(*) FROM inventory.items i LEFT JOIN public.products p ON p.id=i.pos_product_id WHERE i.pos_product_id IS NOT NULL AND p.id IS NULL)::int AS missing_pos_products,
      (SELECT count(*) FROM inventory.items i LEFT JOIN public.branches b ON b.id=i.branch_id WHERE b.id IS NULL)::int AS missing_branches,
      (SELECT count(*) FROM inventory.items WHERE image_path IS NULL OR image_path='')::int AS missing_image_references,
      (SELECT count(*) FROM inventory.items WHERE pos_product_id IS NOT NULL AND coalesce(pos_sync_status,'')<>'synced')::int AS incomplete_pos_links,
      (SELECT count(*) FROM inventory.item_variant_lines l LEFT JOIN public.product_variants v ON v.id=l.pos_variant_id WHERE l.pos_variant_id IS NOT NULL AND v.id IS NULL)::int AS missing_pos_variants,
      (SELECT count(*) FROM inventory.categories c LEFT JOIN inventory.pos_category_map m ON m.image_category_id=c.id WHERE c.active AND m.image_category_id IS NULL)::int AS unmapped_categories`)).rows[0];
    const migrationStatus = await requirePos('./src/services/migrationService').getStatus({
      connect: async () => ({ query: client.query.bind(client), release() {} }),
    });
    const report = { checked_at: new Date().toISOString(), project_id: db.RAILWAY_PROJECT_ID,
      identity, columns, counts, statuses, integrity, migrationStatus };
    fs.writeFileSync(path.join(root, '.test-data/production-discovery.json'), JSON.stringify(report, null, 2));
    await client.query('COMMIT');
    console.log(JSON.stringify({ read_only: identity.read_only, counts, statuses, integrity, migrationStatus }, null, 2));
  } finally { client.release(); await pool.end(); }
}
inspectProductionCatalog().catch((error) => { console.error(error.message); process.exitCode = 1; });
