/** Run the canonical production migration command against the verified local backup. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const readPrivate = (name) => JSON.parse(fs.readFileSync(path.join(root, '.test-data', name), 'utf8').replace(/^\uFEFF/, ''));
const source = readPrivate('production-db-private.json');
const backup = readPrivate('production-backup.json');
assert.equal(source.RAILWAY_PROJECT_ID, 'f06ae302-c116-487a-96d6-4a76a387e533');
assert.equal(source.RAILWAY_ENVIRONMENT_ID, '87667cac-e089-45e8-b67d-2c5d0d25b9a8');
assert.equal(source.RAILWAY_SERVICE_ID, '26829259-55d6-447c-89bf-0474e71edc1f');
assert.equal(backup.source_project, source.RAILWAY_PROJECT_ID);
assert.equal(backup.passed, true);
assert.equal(backup.existing_rows_unchanged_after_migrations, true);
assert.equal(createHash('sha256').update(fs.readFileSync(backup.backup)).digest('hex'), backup.backup_sha256);
const backend = 'C:/Projects/Inventory POS release check/backend';
const requirePos = createRequire(path.join(backend, 'package.json'));
const { Pool } = requirePos('pg');
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DB_|DATABASE_|PG|NODE_ENV|MIGRATION_)/.test(key)));
Object.assign(environment, { NODE_ENV: 'production', DB_HOST: 'autorack.proxy.rlwy.net', DB_PORT: '10669',
  DB_NAME: source.PGDATABASE, DB_USER: source.PGUSER, DB_PASSWORD: source.PGPASSWORD,
  DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'false', DB_CONNECT_TIMEOUT_MS: '15000',
  MIGRATION_BACKUP_PATH: backup.backup });

async function applyReviewedProductionMigrations() {
  // Refuse unexpected migrations, then delegate backup-age and migration checks to the production runner.
  const pool = new Pool({ host: environment.DB_HOST, port: 10669,
    database: source.PGDATABASE, user: source.PGUSER, password: source.PGPASSWORD,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, max: 1,
    options: '-c default_transaction_read_only=on' });
  try {
    const status = await requirePos('./src/services/migrationService').getStatus(pool);
    assert.deepEqual(status.pending, ['106_catalog_workspace_receiving.sql', '107_catalog_photo_handoff.sql', '108_catalog_intake_cancellations.sql']);
    assert.equal(status.checksumMismatches.length, 0);
    assert.equal(status.unknownApplied.length, 0);
  } finally { await pool.end(); }
  const result = await execFile(process.execPath, ['run-migrations.js'], {
    cwd: backend, env: environment, windowsHide: true, timeout: 120000, maxBuffer: 1e6,
  });
  console.log(result.stdout);
  fs.writeFileSync(path.join(root, 'verification/production-migration.json'), JSON.stringify({
    checked_at: new Date().toISOString(), passed: true, project_id: source.RAILWAY_PROJECT_ID,
    canonical_runner: 'backend/run-migrations.js', production_backup_gate_enabled: true,
    backup_sha256: backup.backup_sha256, applied_migrations: [106, 107, 108],
  }, null, 2));
}
applyReviewedProductionMigrations().catch((error) => { console.error(error.message); process.exitCode = 1; });
