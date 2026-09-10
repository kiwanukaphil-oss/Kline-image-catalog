const fs = require('node:fs');
const path = require('node:path');

/** Patch both catalog storage writers together; preserve immutable keys and reject unexpected source drift. */
function applyCatalogStorageMetadataFix(backendDirectory) {
  if (!backendDirectory) throw new Error('Specify the isolated POS backend directory.');
  const replacements = [
    ['catalogImageStorageService.js', 'metadata: { catalog_item_id: String(itemId) }', "metadata: { 'catalog-item-id': String(itemId) }"],
    ['catalogPhotoHandoffService.js', 'metadata: { catalog_item_id: itemId, sha256: digest }', "metadata: { 'catalog-item-id': itemId, sha256: digest }"],
  ];
  const updates = replacements.map(([file, before, after]) => {
    const target = path.join(path.resolve(backendDirectory), 'src/services', file);
    const source = fs.readFileSync(target, 'utf8');
    if (source.includes(after) && !source.includes(before)) return { target, source };
    if (source.split(before).length !== 2) throw new Error(`Unexpected storage metadata source: ${file}`);
    const comment = '// Hyphenated metadata survives the hosted storage proxy; underscored headers caused signature rejection.\n';
    return { target, source: source.replace(before, comment + '    ' + after) };
  });
  for (const update of updates) fs.writeFileSync(update.target, update.source);
  return updates.map(update => update.target);
}

if (require.main === module) console.log(JSON.stringify(applyCatalogStorageMetadataFix(process.argv[2])));
module.exports = { applyCatalogStorageMetadataFix };
