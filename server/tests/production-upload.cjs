/** Read-only proof that the browser's resumed production upload is unique, byte-preserving and unreceived. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const readPrivate = (name) => JSON.parse(fs.readFileSync(path.join(root, '.test-data', name), 'utf8').replace(/^\uFEFF/, ''));
const db = readPrivate('production-db-private.json');
const config = readPrivate('production-api-private.json');
const backup = readPrivate('production-backup.json');
assert.equal(db.RAILWAY_PROJECT_ID, 'f06ae302-c116-487a-96d6-4a76a387e533');
assert.equal(db.RAILWAY_SERVICE_ID, '26829259-55d6-447c-89bf-0474e71edc1f');
assert.equal(db.RAILWAY_ENVIRONMENT_ID, '87667cac-e089-45e8-b67d-2c5d0d25b9a8');
assert.equal(config.RAILWAY_PROJECT_ID, db.RAILWAY_PROJECT_ID);
for (const [key, value] of Object.entries(config)) if (key.startsWith('CATALOG_BUCKET')) process.env[key] = value;
const requirePos = createRequire('C:/Projects/Inventory POS release check/backend/package.json');
const { Pool } = requirePos('pg');
const { downloadPrivateObject } = requirePos('./src/services/railwayObjectStorageService');
const pool = new Pool({ host: 'autorack.proxy.rlwy.net', port: 10669,
  database: db.PGDATABASE, user: db.PGUSER, password: db.PGPASSWORD,
  ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 15000,
  options: '-c default_transaction_read_only=on -c timezone=UTC' });
const itemId = '5e28a317-8cee-425a-9da9-96014729a16a';
const cancelled = process.argv.includes('--cancelled');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function verifyUploadedIntake() {
  // Verify only the explicitly labeled test intake; hash existing records without exposing their contents.
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const batches = (await client.query('SELECT id FROM catalog_workspace.batches WHERE title=$1',
      ['Production upload verification - 7 Sep 2026 - not stock'])).rows;
    assert.equal(batches.length, 1);
    const members = (await client.query('SELECT item_id FROM catalog_workspace.batch_items WHERE batch_id=$1', [batches[0].id])).rows;
    assert.deepEqual(members.map((row) => row.item_id), [itemId]);
    const item = (await client.query('SELECT id,branch_id,image_path,pos_product_id,status FROM inventory.items WHERE id=$1', [itemId])).rows[0];
    assert(item);
    assert.equal(item.branch_id, 'd2622a5b-6397-47c7-9ee3-3d28bcec76c8');
    assert.equal(item.pos_product_id, null);
    assert.equal(item.status, 'draft');
    const cancellation = (await client.query('SELECT reason,restored_at FROM inventory.intake_cancellations WHERE item_id=$1', [itemId])).rows;
    assert.equal(cancellation.length, cancelled ? 1 : 0);
    if (cancelled) assert.equal(cancellation[0].restored_at, null);
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(backup.backup), 'source-manifest.json'), 'utf8'));
    const baseline = manifest.tables.filter((row) => /^"public"\."(products|product_variants|product_images|stock_movements|sales|sale_items)"$/.test(row.table_name) || row.table_name === '"inventory"."catalog_publications"' || row.table_name === '"inventory"."items"');
    const checks = [];
    for (const table of baseline) {
      const excludeTest = table.table_name === '"inventory"."items"';
      const current = (await client.query(`SELECT count(*)::int AS rows,
        md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) AS fingerprint
        FROM (SELECT md5(row_to_json(t)::text) AS row_hash FROM ${table.table_name} t ${excludeTest ? 'WHERE id<>$1' : ''}) existing_rows`, excludeTest ? [itemId] : [])).rows[0];
      assert.equal(current.rows, table.rows);
      assert.equal(current.fingerprint, table.fingerprint);
      checks.push({ table: table.table_name, rows: current.rows, unchanged: true });
    }
    await client.query('COMMIT');
    const image = await downloadPrivateObject(item.image_path);
    const source = fs.readFileSync(path.join(root, 'design/assets/item-0.jpg'));
    assert.equal(sha256(image.buffer), sha256(source));
    const report = { checked_at: new Date().toISOString(), passed: true, read_only: true,
      intake_id: itemId, batches: 1, members: 1, source_bytes: source.length,
      stored_bytes: image.buffer.length, image_sha256: sha256(image.buffer),
      cancelled, received: false, existing_data_checks: checks };
    fs.writeFileSync(path.join(root, `verification/production-upload${cancelled ? '-cancelled' : ''}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { client.release(); await pool.end(); }
}
verifyUploadedIntake().catch((error) => { console.error(error.message); process.exitCode = 1; });
