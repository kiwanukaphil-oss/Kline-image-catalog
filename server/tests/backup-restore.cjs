const {configureTestEnvironment}=require('./environment.cjs');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');
/** Restore a consistent backup into a new disposable local database; never overwrite or drop an existing database. */
async function verifyBackupRestore(){
 const deps=configureTestEnvironment(),{Pool}=deps.posRequire('pg'),{getDatabaseConfig}=deps.source('config/dbConfig');
 const pool=new Pool(getDatabaseConfig()),admin=new Pool(getDatabaseConfig({database:'postgres'}));
 const client=await pool.connect(),name='kline_restore_'+Date.now();assert.match(name,/^kline_restore_\d+$/);
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'kline-backup-')),backup=path.join(folder,'workspace.dump');
 const env={...process.env,PGHOST:process.env.DB_HOST,PGPORT:process.env.DB_PORT,PGUSER:process.env.DB_USER,PGPASSWORD:process.env.DB_PASSWORD};
 const bin='C:/Program Files/PostgreSQL/17/bin';
 const tables=['inventory.items','inventory.item_variant_lines','inventory.catalog_publications','inventory.intake_cancellations','inventory.item_jobs','inventory.item_events','catalog_workspace.batches','catalog_workspace.batch_items','products','product_variants','branch_inventory','stock_movements','user_audit_logs'];
 let restored;
 try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
  const before={};for(const table of tables)before[table]=Number((await client.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
  execFileSync(path.join(bin,'pg_dump.exe'),['--format=custom','--no-owner','--no-acl','--snapshot',snapshot,'--file',backup,'--dbname',process.env.DB_NAME],{env,windowsHide:true,stdio:'pipe',timeout:60000});
  await client.query('COMMIT');await admin.query(`CREATE DATABASE ${name}`);
  execFileSync(path.join(bin,'pg_restore.exe'),['--exit-on-error','--no-owner','--no-acl','--dbname',name,backup],{env,windowsHide:true,stdio:'pipe',timeout:60000});
  restored=new Pool(getDatabaseConfig({database:name}));const after={};for(const table of tables)after[table]=Number((await restored.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
  assert.deepEqual(after,before);
  const migrations=await restored.query("SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%migration%'");
  fs.writeFileSync(path.resolve(__dirname,'../../verification/backup-restore.json'),JSON.stringify({passed:true,database:name,backup_bytes:fs.statSync(backup).size,snapshot_consistent:true,tables:after,migration_ledgers:migrations.rows.map(row=>row.table_name),scope:'Disposable local fixture database only; private object storage requires its own backup and staging restore.'},null,2));
  console.log('PASS consistent local backup restored into '+name+'; '+tables.length+' table counts match. Backup retained at '+backup);
 }finally{client.release();await pool.end();await admin.end();if(restored)await restored.end();}
}
verifyBackupRestore().catch(error=>{console.error(error.message);process.exitCode=1;});
