const fs = require('node:fs');
const path = require('node:path');

/** Let the existing POS publisher join an internal checkout transaction without changing its HTTP contract. */
function applyDeliveryCheckout(backendDirectory) {
  const file = path.resolve(backendDirectory, 'src/services/catalogPublicationService.js');
  let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (source.includes('transactionClient')) return { alreadyApplied:true };
  const before = 'const publishCatalogItem = ({ itemId, branchId, userId, expectedRevision }) =>\n  CatalogPublicationRepository.withTransaction(async (client) => {';
  const after = 'const publishCatalogItem = ({ itemId, branchId, userId, expectedRevision, transactionClient }) =>\n  (transactionClient ? work => work(transactionClient) : work => CatalogPublicationRepository.withTransaction(work))(async (client) => {';
  if (source.split(before).length !== 2) throw Error('Unexpected POS publication source.');
  source = source.replace(before, after);
  fs.writeFileSync(file, source);
  return { applied:true };
}
if (require.main === module) console.log(JSON.stringify(applyDeliveryCheckout(process.argv[2])));
module.exports = { applyDeliveryCheckout };
