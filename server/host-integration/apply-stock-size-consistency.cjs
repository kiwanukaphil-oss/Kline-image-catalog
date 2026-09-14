const fs=require('node:fs'),path=require('node:path');
/** Apply size persistence independently of quantity detection, under the existing AI result transaction and item lock. */
function applyStockSizeConsistency(backendDirectory){
 const root=path.resolve(backendDirectory),file=path.join(root,'src/models/CatalogAiRun.js');
 let source=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
 if(!source.includes('completeSingleStockSize')){
  const anchor='const queueGuard = require("../services/catalogAiQueueGuard.cjs");';
  if(source.split(anchor).length!==2)throw Error('Unexpected AI queue integration.');
  source=source.replace(anchor,anchor+'\nconst { completeSingleStockSize, persistAiStockRows } = require("../services/catalogStockSizeConsistency.cjs");');
  const stockAnchor='      if (stockDistribution && stockDistributionCanAcceptAiSuggestion(current)) {';
  if(source.split(stockAnchor).length!==2)throw Error('Unexpected AI stock suggestion guard.');
  source=source.replace(stockAnchor,stockAnchor+`
        // The currently saved single size wins over an older provider snapshot, including concurrent staff edits.
        const alignedIncoming = completeSingleStockSize(nextAttributes, stockDistribution.entries.map(entry => ({...entry,variant_attributes:{...entry.variant_attributes,size:''}})));
        if (alignedIncoming) stockDistribution = {...stockDistribution,entries:alignedIncoming};`);
  const before='      const nextStatus =';
  if(source.split(before).length!==2)throw Error('Unexpected AI persistence source.');
  source=source.replace(before,`      // A readable size and an observed quantity are independent facts. Keep the current quantity/source.
      const sizeOnlyEntries = completeSingleStockSize(nextAttributes, nextStockDistribution);
      if (sizeOnlyEntries && ["intake_default", "migrated", "ai_suggested"].includes(current.stock_distribution_source)
          && !current.pos_product_id && !current.pos_variant_id && !current.pos_sync_status) {
        const existingLines = (await client.query('SELECT variant_attributes,quantity,publication_status FROM inventory.item_variant_lines WHERE item_id=$1 FOR UPDATE',[itemId])).rows;
        if (existingLines.length === 1 && existingLines[0].publication_status !== 'published'
            && !Object.entries(existingLines[0].variant_attributes || {}).some(([key,value]) => key.toLowerCase() === 'size' && String(value ?? '').trim())
            && Number(sizeOnlyEntries[0].quantity) === nextStockQuantity
            && Object.keys(existingLines[0].variant_attributes || {}).every(key => key === 'size' || existingLines[0].variant_attributes[key] === sizeOnlyEntries[0].variant_attributes[key])
            && (appliedStockDistribution || Number(existingLines[0].quantity) === nextStockQuantity)) {
          appliedChanges.push({fieldPath:'stock_distribution.size',before:nextStockDistribution,after:sizeOnlyEntries});
          nextStockDistribution = sizeOnlyEntries;
          appliedStockDistribution = true;
        }
      }

`+before);
  const call='        await CatalogVariantLine.replaceDistribution(client, {\n          itemId,\n          entries: nextStockDistribution,\n          userId,\n        });';
  if(source.split(call).length!==2)throw Error('Unexpected AI stock row persistence.');
  source=source.replace(call,'        await persistAiStockRows(client, { itemId, entries: nextStockDistribution, userId }, CatalogVariantLine);');
  fs.writeFileSync(file,source);
 }
 fs.copyFileSync(path.join(__dirname,'catalogStockSizeConsistency.cjs'),path.join(root,'src/services/catalogStockSizeConsistency.cjs'));
 return {applied:true};
}
if(require.main===module)console.log(JSON.stringify(applyStockSizeConsistency(process.argv[2])));
module.exports={applyStockSizeConsistency};
