const {canonicalCatalogSize}=require('./catalogExtractionPolicy.cjs');

/** A single explicit size can label an existing quantity; it never supplies or changes that quantity. */
function completeSingleStockSize(attributes, entries) {
  const size=canonicalCatalogSize(attributes?.size);
  if(!/^(?:(?:W\s*|UK\s*|EU\s*|US\s*)?\d{1,3}(?:\.5)?(?:\s*L\s*\d{2,3})?|XXS|XS|S|M|L|XL|[2-9]XL|One Size)$/i.test(size)) return null;
  if(!Array.isArray(entries)||entries.length!==1) return null;
  const entry=entries[0];
  if(Object.entries(entry.variant_attributes||{}).some(([key,value])=>key.toLowerCase()==='size'&&String(value??'').trim())) return null;
  if(!Number.isInteger(Number(entry.quantity))||Number(entry.quantity)<1) return null;
  return [{...entry,variant_attributes:{...(entry.variant_attributes||{}),size}}];
}

/** Preserve a priced placeholder's identity and overrides when AI supplies its single size or explicit quantity. */
async function persistAiStockRows(client,{itemId,entries,userId},VariantLine) {
  const lines=(await client.query('SELECT * FROM inventory.item_variant_lines WHERE item_id=$1 ORDER BY position,id FOR UPDATE',[itemId])).rows;
  if(lines.length===1&&entries.length===1&&lines[0].publication_status!=='published') {
    await client.query('UPDATE inventory.item_variant_lines SET variant_key=MD5($2::jsonb::text),variant_attributes=$2::jsonb,quantity=$3,updated_by=$4 WHERE id=$1',[lines[0].id,JSON.stringify(entries[0].variant_attributes||{}),entries[0].quantity,userId]);
  } else await VariantLine.replaceDistribution(client,{itemId,entries,userId});
}
module.exports={completeSingleStockSize,persistAiStockRows};
