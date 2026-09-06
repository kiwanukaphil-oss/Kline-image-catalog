const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {configureTestEnvironment}=require('./environment.cjs');
/** Check original and restored fixture migration ledgers without applying any changes. */
async function verifyMigrationRecovery(){
 const deps=configureTestEnvironment(),{Pool}=deps.posRequire('pg'),{getDatabaseConfig}=deps.source('config/dbConfig');
 const restored=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../verification/backup-restore.json'),'utf8')).database;
 const results=[];
 for(const database of [process.env.DB_NAME,restored]){
  assert.match(database,/^(kline_catalog_workspace_test|kline_restore_\d+)$/);
  const pool=new Pool(getDatabaseConfig({database}));
  try{const status=await deps.source('services/migrationService').getStatus(pool,{migrationsDir:path.join(deps.root,'src/migrations')});
   assert.deepEqual(status.pending,[]);assert.equal(status.appliedCount,108);assert.equal(status.isUpToDate,true);
   results.push({database,total:status.totalCount,applied:status.appliedCount,pending:status.pending,checksum_mismatches:status.checksumMismatches||status.mismatches||[]});
  }finally{await pool.end();}
 }
 fs.writeFileSync(path.resolve(__dirname,'../../verification/migration-recovery.json'),JSON.stringify({passed:true,results},null,2));console.log('PASS migration state on original and restored fixture databases');
}
verifyMigrationRecovery().catch(error=>{console.error(error.message);process.exitCode=1;});
