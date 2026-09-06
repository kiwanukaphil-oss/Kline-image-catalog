const fs = require('node:fs/promises');
const path = require('node:path');
const { configureTestEnvironment } = require('./environment.cjs');

/** Initialize only the dedicated integration database; existing test and live databases are untouched. */
async function prepareDatabase() {
  const dependencies = configureTestEnvironment();
  const { Pool } = dependencies.posRequire('pg');
  const { getDatabaseConfig } = dependencies.source('config/dbConfig');
  const admin = new Pool(getDatabaseConfig({ database: 'postgres' }));
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [process.env.DB_NAME]);
  if (!existing.rowCount) await admin.query('CREATE DATABASE kline_catalog_workspace_test');
  await admin.end();
  const pool = new Pool(getDatabaseConfig());
  const MigrationService = dependencies.source('services/migrationService');
  await MigrationService.applyPendingMigrations(pool, {
    migrationsDir: path.join(dependencies.root, 'src/migrations'),
    logger: () => {},
  });
  await pool.query(
    await fs.readFile(path.join(__dirname, '../migrations/001_receiving_batches.sql'), 'utf8'),
  );
  const seeded = await pool.query('SELECT 1 FROM users WHERE username=$1', ['testadmin']);
  if (!seeded.rowCount || process.argv.includes('--reset')) {
    // This reset targets only the explicitly named local integration database.
    if (process.env.DB_NAME !== 'kline_catalog_workspace_test')
      throw new Error('Unexpected database target.');
    const helpers = dependencies.posRequire(path.join(dependencies.root, 'tests/helpers/db.js'));
    await helpers.truncateAllTables();
    const { seedAll, IDS } = dependencies.posRequire(path.join(dependencies.root, 'tests/fixtures/seed.js'));
    await seedAll();
    await helpers.closePool();
  }
  {
    const { IDS } = dependencies.posRequire(path.join(dependencies.root, 'tests/fixtures/seed.js'));
    await pool.query(
      `INSERT INTO inventory.categories(id,slug,name) VALUES($1,'trousers','Trousers') ON CONFLICT DO NOTHING`,
      [IDS.catalogCategories.shirts],
    );
    await pool.query(
      `INSERT INTO inventory.category_fields(category_id,key,label,type,required) VALUES
      ($1,'size','Size','size',true),($1,'material','Material','text',false),($1,'color','Colour','text',false) ON CONFLICT DO NOTHING`,
      [IDS.catalogCategories.shirts],
    );
    await pool.query(
      `INSERT INTO inventory.pos_category_map(id,image_category_id,pos_category_id,created_at,updated_at) VALUES(gen_random_uuid(),$1,$2,now(),now()) ON CONFLICT DO NOTHING`,
      [IDS.catalogCategories.shirts, IDS.categories.clothing],
    );
    await pool.query(
      `INSERT INTO user_permissions(user_id,permission_id,granted)
      SELECT $1,id,true FROM permissions WHERE name IN('catalog.view','catalog.edit','catalog.upload') ON CONFLICT DO NOTHING`,
      [IDS.users.cashier],
    );
  }
  await pool.end();
  console.log('Dedicated K-Line integration database ready.');
}
if (require.main === module)
  prepareDatabase().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { prepareDatabase };
