/** Back up the live POS read-only, then rehearse restoration/migrations in a separate staging database. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const requirePos = createRequire('C:/Projects/Inventory POS release check/backend/package.json');
const { Pool } = requirePos('pg');
const migrationService = requirePos('./src/services/migrationService');
const root = path.resolve(__dirname, '../..');
const readPrivate = (name) => JSON.parse(fs.readFileSync(path.join(root, '.test-data', name), 'utf8').replace(/^\uFEFF/, ''));
const source = readPrivate('production-db-private.json');
const staging = readPrivate('railway-staging-private.json').database;
const proxy = readPrivate('production-rehearsal-proxy.json').proxy;
assert.equal(source.RAILWAY_PROJECT_ID, 'f06ae302-c116-487a-96d6-4a76a387e533');
assert.equal(source.RAILWAY_SERVICE_ID, '26829259-55d6-447c-89bf-0474e71edc1f');
assert.equal(staging.RAILWAY_PROJECT_ID, '9ce0cab6-9ab1-4da3-854b-afcf4cfa914b');
const quoteIdentifier = (name) => '"' + name.replaceAll('"', '""') + '"';
const sourceConfig = { host: 'autorack.proxy.rlwy.net', port: 10669,
  database: source.PGDATABASE, user: source.PGUSER, password: source.PGPASSWORD,
  ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 15000,
  options: '-c default_transaction_read_only=on -c timezone=UTC' };
const stagingConfig = { host: proxy.domain, port: proxy.proxyPort,
  database: staging.PGDATABASE, user: staging.PGUSER, password: staging.PGPASSWORD,
  ssl: { rejectUnauthorized: false }, max: 2, connectionTimeoutMillis: 15000,
  options: '-c timezone=UTC' };
const baseEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));

function postgresEnvironment(config) {
  return { ...baseEnvironment, PGHOST: config.host, PGPORT: String(config.port),
    PGDATABASE: config.database, PGUSER: config.user, PGPASSWORD: config.password,
    PGSSLMODE: 'require', PGOPTIONS: '-c timezone=UTC', PGCONNECT_TIMEOUT: '20' };
}

async function fingerprintTables(client, tables) {
  // Hash sorted rows in PostgreSQL; customer records and passwords never enter reports.
  const queries = tables.map((table, index) => `SELECT $${index + 1}::text AS table_name,
    count(*)::int AS rows, md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) AS fingerprint
    FROM (SELECT md5(row_to_json(t)::text) AS row_hash FROM ${table} t) rows_to_hash`);
  return (await client.query(queries.join(' UNION ALL '), tables)).rows.sort((a,b) => a.table_name.localeCompare(b.table_name));
}

async function backupAndRehearse() {
  // Restore only into a freshly named database in the isolated staging project.
  const folder = path.join(process.env.LOCALAPPDATA, 'KLineMigrationEvidence', 'catalog-redesign', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(folder, { recursive: true });
  const dump = path.join(folder, 'production-before-workspace.dump');
  const rehearsalDatabase = `catalog_production_rehearsal_${Date.now()}`;
  assert.match(rehearsalDatabase, /^catalog_production_rehearsal_\d+$/);
  const sourcePool = new Pool(sourceConfig);
  const adminPool = new Pool(stagingConfig);
  let restoredPool;
  const client = await sourcePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const tables = (await client.query("SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema IN ('public','inventory','catalog_workspace') AND table_type='BASE TABLE' ORDER BY table_schema,table_name")).rows
      .map((table) => `${quoteIdentifier(table.table_schema)}.${quoteIdentifier(table.table_name)}`);
    const before = await fingerprintTables(client, tables);
    const imageKeys = (await client.query("SELECT image_path AS key FROM inventory.items WHERE image_path IS NOT NULL AND image_path<>'' UNION SELECT image_path FROM public.products WHERE image_path IS NOT NULL AND image_path<>'' UNION SELECT image_path FROM public.product_images WHERE image_path IS NOT NULL AND image_path<>'' ORDER BY key")).rows.map((row) => row.key);
    fs.writeFileSync(path.join(folder, 'source-manifest.json'), JSON.stringify({ tables: before, image_keys: imageKeys }, null, 2));
    await execFile('C:/Users/kiwan/pg18/bin/pg_dump.exe', ['--format=custom','--no-owner','--no-acl','--snapshot',snapshot,'--file',dump],
      { env: postgresEnvironment(sourceConfig), windowsHide: true, timeout: 300000, maxBuffer: 2e6 });
    await client.query('COMMIT');
    console.log('Fresh consistent production backup captured; restoring into isolated PostgreSQL 18.');
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(rehearsalDatabase)}`);
    const restoredConfig = { ...stagingConfig, database: rehearsalDatabase };
    await execFile('C:/Users/kiwan/pg18/bin/pg_restore.exe', ['--exit-on-error','--no-owner','--no-acl','--dbname',rehearsalDatabase,dump],
      { env: postgresEnvironment(restoredConfig), windowsHide: true, timeout: 300000, maxBuffer: 2e6 });
    restoredPool = new Pool(restoredConfig);
    assert.deepEqual(await fingerprintTables(restoredPool, tables), before);
    const migrationBefore = await migrationService.getStatus(restoredPool);
    assert.deepEqual(migrationBefore.pending, ['106_catalog_workspace_receiving.sql','107_catalog_photo_handoff.sql','108_catalog_intake_cancellations.sql']);
    assert.equal(migrationBefore.checksumMismatches.length, 0);
    await migrationService.applyPendingMigrations(restoredPool);
    const migrationAfter = await migrationService.assertDatabaseIsUpToDate(restoredPool);
    const commerceTables = tables.filter((table) => table !== '"public"."schema_migrations"');
    assert.deepEqual(await fingerprintTables(restoredPool, commerceTables), before.filter((table) => table.table_name !== '"public"."schema_migrations"'));
    const report = { checked_at: new Date().toISOString(), passed: true,
      source_project: source.RAILWAY_PROJECT_ID, destination_project: staging.RAILWAY_PROJECT_ID,
      rehearsal_database: rehearsalDatabase, backup: dump, backup_bytes: fs.statSync(dump).size,
      backup_sha256: crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex'),
      matched_tables: tables.length, migrations_after: migrationAfter.appliedCount,
      existing_rows_unchanged_after_migrations: true, referenced_image_keys: imageKeys.length };
    fs.writeFileSync(path.join(folder, 'backup-restore.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(root, '.test-data/production-backup.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    client.release(); await sourcePool.end(); await adminPool.end(); if(restoredPool) await restoredPool.end();
  }
}
backupAndRehearse().catch((error) => { console.error(error.message); process.exitCode = 1; });
