const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(root, 'src/models/CatalogAiRun.js'))) throw Error('Specify the isolated POS backend directory.');

/** Apply exact anchors to the reviewed host; fail on drift instead of guessing at integration points. */
function replaceExact(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Host source differs at: ' + before.slice(0, 100));
  return source.replace(before, after);
}
const modelPath = path.join(root, 'src/models/CatalogAiRun.js');
let model = fs.readFileSync(modelPath, 'utf8').replace(/\r\n/g, '\n');
if (!model.includes('catalogAiQueueGuard')) {
  model = replaceExact(model, 'const CatalogVariantLine = require("./CatalogVariantLine");', 'const CatalogVariantLine = require("./CatalogVariantLine");\nconst queueGuard = require("../services/catalogAiQueueGuard.cjs");');
  model = replaceExact(model, '    model,\n  }) {', '    model,\n    queueClaim,\n  }) {');
  model = replaceExact(model, "      await client.query('SELECT id FROM inventory.items WHERE id=$1 AND branch_id=$2 FOR UPDATE',[itemId,branchId]);", "      await client.query(\"SELECT pg_advisory_xact_lock(hashtext('catalog.ai.queue'))\");\n      await client.query('SELECT id FROM inventory.items WHERE id=$1 AND branch_id=$2 FOR UPDATE',[itemId,branchId]);\n      await queueGuard.requireReservation(client, itemId, queueClaim);");
  model = replaceExact(model, '      await client.query("COMMIT");\n      return {\n        item,', '      await queueGuard.linkAttempt(client, queueClaim, jobResult.rows[0].id, usageResult.rows[0].id);\n      await client.query("COMMIT");\n      return {\n        item,');
  model = replaceExact(model, '      const current = currentResult.rows[0];', '      await queueGuard.requireLiveAttempt(client, jobId);\n      const current = currentResult.rows[0];');
  model = replaceExact(model, '      const nextAttributes = { ...(current.attributes || {}) };', "      if ((await client.query('SELECT 1 FROM inventory.intake_cancellations WHERE item_id=$1 AND restored_at IS NULL',[itemId])).rowCount)\n        throw DomainError.conflict('This intake was cancelled while AI was running.');\n      const nextAttributes = { ...(current.attributes || {}) };");
  model = replaceExact(model, '      await client.query("COMMIT");\n\n      return {\n        id: itemId,', '      await queueGuard.completeEntry(client, jobId);\n      await client.query("COMMIT");\n\n      return {\n        id: itemId,');
  model = replaceExact(model, '         WHERE id = $1\n       )', "         WHERE id = $1 AND status='attempted'\n       )");
}
if (!model.includes('backgroundQueueVersion = 1')) model += '\nmodule.exports.backgroundQueueVersion = 1;\n';
const servicePath = path.join(root, 'src/services/catalogAiExtractionService.js');
let service = fs.readFileSync(servicePath, 'utf8').replace(/\r\n/g, '\n');
if (!service.includes('userId, queueClaim')) {
  service = replaceExact(service, 'const extractCatalogItem = async ({ itemId, branchId, userId }) => {', 'const extractCatalogItem = async ({ itemId, branchId, userId, queueClaim }) => {');
  service = replaceExact(service, '    provider: "openai",\n    model,', '    provider: "openai",\n    model,\n    queueClaim,');
}
// Persist only after all source anchors have been validated.
fs.writeFileSync(modelPath, model);
fs.writeFileSync(servicePath, service);
fs.copyFileSync(path.join(__dirname, 'catalogAiQueueGuard.cjs'), path.join(root, 'src/services/catalogAiQueueGuard.cjs'));
console.log('Queue ownership integrated into the isolated POS extraction host.');
