/** Compare catalog/commerce records with the pre-release backup without reading their contents into logs. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const readPrivate = (name) => JSON.parse(fs.readFileSync(path.join(root, '.test-data', name), 'utf8').replace(/^\uFEFF/, ''));
const source = readPrivate('production-db-private.json');
const backup = readPrivate('production-backup.json');
assert.equal(source.RAILWAY_PROJECT_ID, 'f06ae302-c116-487a-96d6-4a76a387e533');
assert.equal(source.RAILWAY_ENVIRONMENT_ID, '87667cac-e089-45e8-b67d-2c5d0d25b9a8');
assert.equal(source.RAILWAY_SERVICE_ID, '26829259-55d6-447c-89bf-0474e71edc1f');
const requirePos = createRequire('C:/Projects/Inventory POS release check/backend/package.json');
const { Pool } = requirePos('pg');
const pool = new Pool({ host: 'autorack.proxy.rlwy.net', port: 10669,
  database: source.PGDATABASE, user: source.PGUSER, password: source.PGPASSWORD,
  ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 15000,
  options: '-c default_transaction_read_only=on -c timezone=UTC' });

async function verifyProductionContinuity() {
  // Only compare catalog and commerce tables: legitimate logins can change users/audit tables.
  const folder = path.dirname(backup.backup || backup.dump || backup.backup_path);
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'source-manifest.json'), 'utf8'));
  const tables = manifest.tables.filter((table) => table.table_name.startsWith('"inventory".') ||
    /^"public"\."(products|product_variants|product_images|stock_movements|sales|sale_items)"$/.test(table.table_name));
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const checks = [];
    for (const table of tables) {
      assert.match(table.table_name, /^"(?:inventory|public)"\."[a-z_]+"$/);
      const result = (await client.query(`SELECT count(*)::int AS rows,
        md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) AS fingerprint
        FROM (SELECT md5(row_to_json(t)::text) AS row_hash FROM ${table.table_name} t) source_rows`)).rows[0];
      checks.push({ table: table.table_name, rows: result.rows,
        unchanged: result.rows === table.rows && result.fingerprint === table.fingerprint });
    }
    const migrations = await requirePos('./src/services/migrationService').getStatus({
      connect: async () => ({ query: client.query.bind(client), release() {} }),
    });
    const report = { checked_at: new Date().toISOString(), read_only: true, checks, migrations,
      passed: checks.every((check) => check.unchanged) && migrations.pending.length === 0 };
    fs.writeFileSync(path.join(root, 'verification/production-continuity.json'), JSON.stringify(report, null, 2));
    await client.query('COMMIT');
    console.log(JSON.stringify(report, null, 2));
    assert(report.passed, 'Investigate any changed table before asserting data continuity');
  } finally { client.release(); await pool.end(); }
}
verifyProductionContinuity().catch((error) => { console.error(error.message); process.exitCode = 1; });
