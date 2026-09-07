/** Preserve every referenced private image as verified local bytes; never modify source objects. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const requirePos = createRequire('C:/Projects/Inventory POS release check/backend/package.json');
const config = JSON.parse(fs.readFileSync(path.join(root,'.test-data/production-api-private.json'),'utf8').replace(/^\uFEFF/,''));
assert.equal(config.RAILWAY_PROJECT_ID, 'f06ae302-c116-487a-96d6-4a76a387e533');
for (const [key,value] of Object.entries(config)) if (key.startsWith('CATALOG_BUCKET')) process.env[key] = value;
const { downloadPrivateObject } = requirePos('./src/services/railwayObjectStorageService');
const evidenceRoot = path.join(process.env.LOCALAPPDATA,'KLineMigrationEvidence','catalog-redesign');
const folder = fs.readdirSync(evidenceRoot).sort().reverse().map((name)=>path.join(evidenceRoot,name))
  .find((candidate)=>fs.existsSync(path.join(candidate,'source-manifest.json')) && fs.statSync(path.join(candidate,'production-before-workspace.dump')).size>0);
assert(folder, 'Capture the source database snapshot first');
const keys = JSON.parse(fs.readFileSync(path.join(folder,'source-manifest.json'),'utf8')).image_keys;
const imageFolder = path.join(folder,'images');
fs.mkdirSync(imageFolder,{recursive:true});
const manifestFile = path.join(folder,'image-backup.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile,'utf8')) : {objects:{},failures:[]};
const digest = (bytes)=>crypto.createHash('sha256').update(bytes).digest('hex');

async function preserveImage(key) {
  // Stable source keys are stored under hashed local filenames, never interpreted as filesystem paths.
  const filename = `${digest(key)}.bin`;
  const destination = path.join(imageFolder, filename);
  const prior = manifest.objects[key];
  if (prior && fs.existsSync(destination) && digest(fs.readFileSync(destination))===prior.sha256) return;
  const image = await downloadPrivateObject(key);
  assert(image.buffer.length>0);
  assert.equal(image.buffer.length,image.contentLength);
  fs.writeFileSync(destination,image.buffer);
  const sha256 = digest(image.buffer);
  assert.equal(digest(fs.readFileSync(destination)),sha256);
  manifest.objects[key]={filename,bytes:image.buffer.length,sha256,content_type:image.contentType};
}

async function backupPhotos() {
  // Persist progress after each bounded group so interrupted downloads resume without re-copying images.
  manifest.failures=[];
  for(let offset=0;offset<keys.length;offset+=4){
    const group=keys.slice(offset,offset+4);
    const outcomes=await Promise.allSettled(group.map(preserveImage));
    outcomes.forEach((outcome,index)=>{if(outcome.status==='rejected')manifest.failures.push({key:group[index],error:outcome.reason?.name || 'DownloadFailed'});});
    fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));
    if(offset%100===0) console.log(`Photo backup: ${Math.min(offset+4,keys.length)}/${keys.length} checked; ${manifest.failures.length} failures.`);
  }
  assert.equal(manifest.failures.length,0,'Every referenced image must be recoverable before cutover');
  assert.equal(Object.keys(manifest.objects).length,keys.length);
  const report={checked_at:new Date().toISOString(),passed:true,source_project:config.RAILWAY_PROJECT_ID,
    objects:keys.length,bytes:Object.values(manifest.objects).reduce((sum,item)=>sum+item.bytes,0),
    folder,manifest_sha256:digest(fs.readFileSync(manifestFile)),all_local_hashes_verified:true,source_objects_unchanged:true};
  fs.writeFileSync(path.join(root,'.test-data/production-photo-backup.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
backupPhotos().catch(error=>{console.error(error.message);process.exitCode=1;});
