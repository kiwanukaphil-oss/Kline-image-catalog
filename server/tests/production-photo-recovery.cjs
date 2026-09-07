/** Prove one backed-up photo can be restored to the isolated private staging bucket. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const readPrivate = (name) => JSON.parse(fs.readFileSync(path.join(root, '.test-data', name), 'utf8').replace(/^\uFEFF/, ''));
const backup = readPrivate('production-photo-backup.json');
const staging = readPrivate('railway-staging-private.json');
const production = readPrivate('production-api-private.json');
assert.equal(backup.passed, true);
assert.equal(staging.database.RAILWAY_PROJECT_ID, '9ce0cab6-9ab1-4da3-854b-afcf4cfa914b');
assert.notEqual(staging.bucket.bucketName, production.CATALOG_BUCKET);
Object.assign(process.env, {
  CATALOG_BUCKET: staging.bucket.bucketName,
  CATALOG_BUCKET_ENDPOINT: staging.bucket.endpoint,
  CATALOG_BUCKET_ACCESS_KEY_ID: staging.bucket.accessKeyId,
  CATALOG_BUCKET_SECRET_ACCESS_KEY: staging.bucket.secretAccessKey,
  CATALOG_BUCKET_REGION: staging.bucket.region,
  CATALOG_BUCKET_URL_STYLE: staging.bucket.urlStyle,
  AWS_REQUEST_CHECKSUM_CALCULATION: 'WHEN_REQUIRED',
});
const requirePos = createRequire('C:/Projects/Inventory POS release check/backend/package.json');
const storage = requirePos('./src/services/railwayObjectStorageService');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function rehearsePhotoRecovery() {
  // A new verification-only key avoids overwriting catalog photos in either environment.
  const manifest = JSON.parse(fs.readFileSync(path.join(backup.folder, 'image-backup.json'), 'utf8'));
  const entry = Object.values(manifest.objects)[0];
  assert.match(entry.filename, /^[a-f0-9]{64}\.bin$/);
  const buffer = fs.readFileSync(path.join(backup.folder, 'images', entry.filename));
  assert.equal(digest(buffer), entry.sha256);
  const objectKey = `verification/production-recovery/${randomUUID()}.bin`;
  let created = false;
  try {
    const uploaded = await storage.storePrivateObjectIfAbsent({ objectKey, buffer, contentType: entry.content_type });
    assert.equal(uploaded.created, true);
    created = true;
    const recovered = await storage.downloadPrivateObject(objectKey);
    assert.equal(digest(recovered.buffer), entry.sha256);
    assert.equal(recovered.contentLength, buffer.length);
    const report = { checked_at: new Date().toISOString(), passed: true, bytes: buffer.length,
      sha256: entry.sha256, destination: 'isolated staging bucket', production_objects_unchanged: true };
    fs.writeFileSync(path.join(root, 'verification/production-photo-recovery.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (created) await storage.deletePrivateObject(objectKey);
  }
}
rehearsePhotoRecovery().catch((error) => { console.error(error.name); process.exitCode = 1; });
