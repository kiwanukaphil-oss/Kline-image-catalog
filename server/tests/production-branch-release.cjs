/** Guarded migration 109 release: fresh private dump, exact pending set and unchanged stock. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const backend = 'C:/Projects/Inventory POS release check/backend';
const requirePos = createRequire(path.join(backend, 'package.json'));
const { Pool } = requirePos('pg');
const migrations = requirePos('./src/services/migrationService');
const source = JSON.parse(fs.readFileSync(path.join(root, '.test-data/production-db-private.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(source.RAILWAY_PROJECT_ID, 'f06ae302-c116-487a-96d6-4a76a387e533');
assert.equal(source.RAILWAY_ENVIRONMENT_ID, '87667cac-e089-45e8-b67d-2c5d0d25b9a8');
assert.equal(source.RAILWAY_SERVICE_ID, '26829259-55d6-447c-89bf-0474e71edc1f');
const config = { host: 'autorack.proxy.rlwy.net', port: 10669, database: source.PGDATABASE,
  user: source.PGUSER, password: source.PGPASSWORD, ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000, max: 1, options: '-c default_transaction_read_only=on' };
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DB_|DATABASE_|PG|NODE_ENV|MIGRATION_)/.test(key)));

async function stockFingerprint(client) {
  const result = await client.query(`SELECT count(*)::int AS rows,
    md5(coalesce(string_agg(branch_id::text || ':' || variant_id::text || ':' || stock_quantity::text,
      ',' ORDER BY branch_id, variant_id), '')) AS fingerprint FROM branch_inventory`);
  return result.rows[0];
}

async function releaseBranchMigration() {
  // Export one consistent snapshot; dump stays outside Git and no credentials enter logs.
  const pool = new Pool(config);
  try {
    const status = await migrations.getStatus(pool);
    assert.deepEqual(status.pending, ['109_branch_product_assortments.sql']);
    assert.equal(status.checksumMismatches.length, 0);
    assert.equal(status.unknownApplied.length, 0);
    const folder = path.join(process.env.LOCALAPPDATA, 'KLineMigrationEvidence', 'branch-assortment', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(folder, { recursive: true });
    const dump = path.join(folder, 'production-before-109.dump');
    const client = await pool.connect();
    let before;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
      before = await stockFingerprint(client);
      await execFile('C:/Users/kiwan/pg18/bin/pg_dump.exe', ['--format=custom', '--no-owner', '--no-acl', '--snapshot', snapshot, '--file', dump], {
        env: { ...cleanEnvironment, PGHOST: config.host, PGPORT: String(config.port), PGDATABASE: config.database,
          PGUSER: config.user, PGPASSWORD: config.password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '20' },
        windowsHide: true, timeout: 300000, maxBuffer: 2000000,
      });
      await client.query('COMMIT');
    } finally { client.release(); }
    const listed = await execFile('C:/Users/kiwan/pg18/bin/pg_restore.exe', ['--list', dump], { windowsHide: true, maxBuffer: 4000000 });
    assert.match(listed.stdout, /TABLE DATA public branch_inventory/);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex');
    fs.writeFileSync(path.join(folder, 'backup.json'), JSON.stringify({ dump, sha256, before }, null, 2));
    console.log('Fresh production dump verified; applying only migration 109 with the production backup gate enabled.');
    const result = await execFile(process.execPath, ['run-migrations.js'], { cwd: backend, windowsHide: true, timeout: 120000, maxBuffer: 1000000,
      env: { ...cleanEnvironment, NODE_ENV: 'production', DB_HOST: config.host, DB_PORT: String(config.port),
        DB_NAME: config.database, DB_USER: config.user, DB_PASSWORD: config.password, DB_SSL: 'true',
        DB_SSL_REJECT_UNAUTHORIZED: 'false', DB_CONNECT_TIMEOUT_MS: '20000', MIGRATION_BACKUP_PATH: dump },
    });
    console.log(result.stdout);
    const after = await stockFingerprint(pool);
    assert.deepEqual(after, before, 'Stock balances changed during release; investigate before declaring continuity.');
    const afterStatus = await migrations.assertDatabaseIsUpToDate(pool);
    const branches = (await pool.query(`SELECT b.name, count(bi.variant_id)::int AS inventory_rows,
      count(bi.variant_id) FILTER (WHERE bi.is_assorted)::int AS assortment_skus,
      coalesce(sum(bi.stock_quantity),0)::int AS units FROM branches b
      LEFT JOIN branch_inventory bi ON bi.branch_id=b.id GROUP BY b.id ORDER BY b.name`)).rows;
    const report = { checked_at: new Date().toISOString(), passed: true, migration: 109,
      backup_bytes: fs.statSync(dump).size, backup_sha256: sha256, dump_archive_verified: true,
      production_backup_gate_enabled: true, stock_balances_unchanged: true,
      migrations_applied: afterStatus.appliedCount, branches };
    fs.writeFileSync(path.join(root, 'verification/production-branch-migration.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await pool.end(); }
}
releaseBranchMigration().catch(error => { console.error(error.message); process.exitCode = 1; });
