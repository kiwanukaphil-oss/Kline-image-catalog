const { canonicalCatalogSize } = require('./host-integration/catalogExtractionPolicy.cjs');

/** Compose a simple delivery journey over the existing POS stock engine, with one atomic receipt per product. */
function createDeliveryCheckout(dependencies, matching) {
  const { source } = dependencies;
  const repository = source('repositories/CatalogPublicationRepository');
  const { pool } = source('config/database');
  const DomainError = source('errors/DomainError');
  const { catalogPublicationBlockers, createPublicationRevision, publishCatalogItem } = source('services/catalogPublicationService');
  if(!publishCatalogItem.toString().includes('transactionClient')) throw Error('Apply host-integration/apply-delivery-checkout.cjs to the POS backend before enabling delivery checkout.');
  const { createCatalogImageUrl } = source('services/catalogImageStorageService');
  const { transferCatalogPhoto } = source('services/catalogPhotoHandoffService');
  const VariantLine = source('models/CatalogVariantLine');
  const { normalizeCatalogStockDistribution, expandCatalogSizeLabel } = source('utils/catalogStockDistribution');
  const { roundMoney } = source('utils/moneyUtils');
  const received = context => !!(context.item.publication_id || context.item.pos_product_id && context.item.pos_sync_status === 'synced');
  const sign = (snapshot, actor) => createPublicationRevision(snapshot, actor);
  const number = value => value == null ? null : Number(value);
  const money = (value, allowZero=false) => {
    if (value === '' || value == null) return null;
    if (!['string','number'].includes(typeof value) || !Number.isFinite(Number(value)) || (allowZero ? Number(value) < 0 : Number(value) <= 0) || Number(value) > 99999999.99)
      throw DomainError.validationFailed('Enter a price greater than zero, with at most two decimal places.');
    if (Math.abs(roundMoney(value) - Number(value)) > 0.000001) throw DomainError.validationFailed('Use at most two decimal places.');
    return roundMoney(value);
  };
  const issues = context => catalogPublicationBlockers({ ...context, item:{ ...context.item, stock_distribution_source:'human_confirmed' } })
    .filter(message => message !== 'Receive this lot through its matched product group.')
    .map(message => message.includes('Map this catalog category') ? 'Category setup needed. Ask a supervisor to set up this category once.' : message);

  async function contextFor(client, itemId, branchId) {
    const context = await repository.loadLockedContext(client, {itemId,branchId});
    if (!context) throw DomainError.notFound('Item unavailable in this branch.');
    return context;
  }

  /** Expand existing confirmed groups only; a lack of reliable identity means a new product, never a forced match. */
  async function selectedUnits(itemIds, branchId) {
    const plans = (await pool.query('SELECT id,item_ids FROM catalog_workspace.product_matches WHERE branch_id=$1 AND retired_at IS NULL AND result_product_id IS NULL AND item_ids && $2::uuid[] ORDER BY id',[branchId,itemIds])).rows;
    const grouped = new Set(plans.flatMap(plan=>plan.item_ids));
    return [...plans.map(plan=>({id:plan.id,group:true,item_ids:plan.item_ids})),...itemIds.filter(id=>!grouped.has(id)).map(id=>({id,group:false,item_ids:[id]}))];
  }

  /** Project costs only for authorized operators; defaults stay suggestions until the final send. */
  async function present(context, actor) {
    const {item,lines,fields} = context;
    return {id:item.id,name:item.name || '',image_url:await createCatalogImageUrl(item.image_path),attributes:item.attributes || {},
      required_fields:fields.filter(field=>field.required && field.key!=='size'),has_size:fields.some(field=>field.key==='size'),
      revision:sign(context,actor),is_published:received(context),is_cancelled:!!item.intake_cancelled_at,
      count_source:item.stock_distribution_source,issues:received(context)?[]:issues(context),
      lines:lines.map(line=>({id:line.id,size:line.variant_attributes.size || '',quantity:Number(line.quantity),
        price:number(line.price_override ?? item.price),...(actor.canViewCost?{cost:number(line.cost_override ?? item.base_cost_price)}:{}),
        cost_missing:line.cost_override == null && item.base_cost_price == null}))};
  }

  /** Lock a whole existing group before its items, using the matching service's lock order. */
  async function reviewUnit(client, unit, actor) {
    let plan = null;
    if(unit.group) {
      plan=(await client.query('SELECT * FROM catalog_workspace.product_matches WHERE id=$1 AND branch_id=$2 FOR UPDATE',[unit.id,actor.branchId])).rows[0];
      if(!plan || plan.retired_at) throw DomainError.conflict('Product link changed. Return to pricing and review again.');
      if(JSON.stringify([...plan.item_ids].sort())!==JSON.stringify([...unit.item_ids].sort())) throw DomainError.conflict('Product membership changed. Reload this delivery.');
    }
    const contexts=[];
    for(const id of [...unit.item_ids].sort()) contexts.push(await contextFor(client,id,actor.branchId));
    if(contexts.every(received)) return {unit,already_received:true,item_ids:unit.item_ids};
    if(contexts.some(received)) throw DomainError.conflict('Part of this product was already received. Reload this delivery.');
    if(!unit.group && contexts[0].item.product_match_id) throw DomainError.conflict('This item now belongs to an existing product group. Reload this delivery.');
    const blockers=contexts.flatMap(context=>issues(context).map(message=>`${context.item.name || 'Unnamed item'}: ${message}`));
    if(blockers.length) throw DomainError.validationFailed(blockers.join(' '));
    const groupReview=plan?await matching.receive({...actor,id:plan.id,transactionClient:client,allowProposedCounts:true}):null;
    const summaryRows=groupReview?groupReview.rows.map(row=>({size:Object.values(row.attributes).join(' / '),quantity:row.quantity,price:row.price})):contexts[0].lines.map(line=>({size:line.variant_attributes.size || contexts[0].item.attributes?.size || '',quantity:Number(line.quantity),price:Number(line.price_override ?? contexts[0].item.price)}));
    return {unit,contexts,revision:sign({unit,contexts,groupRevision:groupReview?.revision || null},actor),item_ids:unit.item_ids,
      name:groupReview?.product_name || contexts[0].item.name,outcome:plan?.target_product_id?'Added to existing product':'New product',
      image_url:await createCatalogImageUrl(contexts[0].item.image_path),rows:summaryRows};
  }

  return {
    async read(itemIds, actor) {
      const units=await selectedUnits(itemIds,actor.branchId),ids=[...new Set(units.flatMap(unit=>unit.item_ids))];
      const results=[];
      for(const id of ids) {
        try { results.push({id,item:await repository.withTransaction(async client=>present(await contextFor(client,id,actor.branchId),actor))}); }
        catch(error) {results.push({id,error:error instanceof DomainError?error.message:'Unable to load item. Retry loading.'});}
      }
      return {results,groups:units.filter(unit=>unit.group).map(unit=>unit.item_ids),expanded:ids.length-itemIds.length};
    },

    /** Save prices and proposed sizes together; preserve existing protected costs and reject stale snapshots. */
    async save(row, actor) {
      return repository.withTransaction(async client=>{
        const context=await contextFor(client,row.id,actor.branchId),{item}=context;
        if(received(context)||item.pos_product_id||item.intake_cancelled_at) throw DomainError.conflict('This item can no longer be edited as incoming stock.');
        if(sign(context,actor)!==row.revision) throw DomainError.conflict('This item changed. Reload it before saving.');
        if(!Array.isArray(row.lines)||!row.lines.length||row.lines.length>100) throw DomainError.validationFailed('Use 1 to 100 size rows per item.');
        if(typeof row.name!=='string'||row.name.trim().length>250) throw DomainError.validationFailed('Enter a product name of at most 250 characters.');
        const hasSize=context.fields.some(field=>field.key==='size');
        const entries=row.lines.map(line=>({quantity:line.quantity,variant_attributes:hasSize&&String(line.size||'').trim()?{size:canonicalCatalogSize(line.size)}:{}}));
        if(entries.some(entry=>expandCatalogSizeLabel(entry.variant_attributes.size).length>1)) throw DomainError.validationFailed('Put each size on a separate row.');
        const normalized=normalizeCatalogStockDistribution(entries,{allowedAttributeKeys:new Set(hasSize?['size']:[])});
        // Preserve non-size dimensions from saved lines; the simple UI never invents or discards them.
        normalized.entries=entries.map((entry,index)=>({...entry,variant_attributes:{...context.lines.find(line=>line.id===row.lines[index].id)?.variant_attributes,...entry.variant_attributes}}));
        for(let index=0;index<normalized.entries.length;index++) if(hasSize&&!String(row.lines[index].size||'').trim()) delete normalized.entries[index].variant_attributes.size;
        const variantKeys=normalized.entries.map(entry=>JSON.stringify(Object.entries(entry.variant_attributes).sort()));
        if(new Set(variantKeys).size!==row.lines.length) throw DomainError.validationFailed('Combine duplicate size rows.');
        const prices=row.lines.map(line=>money(line.price));
        const costs=row.lines.map(line=>{
          if(!actor.canViewCost && Object.hasOwn(line,'cost')) throw new DomainError('Cost access is required.',403);
          const old=context.lines.find(saved=>saved.id===line.id);
          return actor.canViewCost?money(line.cost,true):number(old?.cost_override ?? item.base_cost_price);
        });
        const attributes={...(item.attributes||{})};
        for(const [key,value] of Object.entries(row.attributes||{})) {
          const field=context.fields.find(field=>field.key===key && field.required && key!=='size');
          if(!field || !['string','number','boolean'].includes(typeof value)) throw DomainError.validationFailed('Invalid required product detail.');
          if(field.type==='number' && !Number.isFinite(Number(value))) throw DomainError.validationFailed(`${field.label} must be numeric.`);
          attributes[key]=field.type==='number'?Number(value):value;
        }
        await VariantLine.replaceDistribution(client,{itemId:row.id,entries:normalized.entries,userId:actor.userId});
        const newLines=(await client.query('SELECT id FROM inventory.item_variant_lines WHERE item_id=$1 ORDER BY position,id',[row.id])).rows;
        for(let n=0;n<newLines.length;n++) await client.query('UPDATE inventory.item_variant_lines SET price_override=$2,cost_override=$3,updated_by=$4 WHERE id=$1',[newLines[n].id,prices[n],costs[n],actor.userId]);
        const countChanged=JSON.stringify(entries)!==JSON.stringify(context.lines.map(line=>({quantity:Number(line.quantity),variant_attributes:line.variant_attributes})));
        await client.query(`UPDATE inventory.items SET name=$3,attributes=$4::jsonb,stock_distribution=$5::jsonb,stock_quantity=$6,
          stock_distribution_source=CASE WHEN $7 THEN 'ai_suggested' ELSE stock_distribution_source END,updated_by=$8 WHERE id=$1 AND branch_id=$2`,[row.id,actor.branchId,row.name.trim(),JSON.stringify(attributes),JSON.stringify(normalized.entries),normalized.totalQuantity,countChanged,actor.userId]);
        await client.query("INSERT INTO user_audit_logs(user_id,action,module,description) VALUES($1,'catalog.delivery.save','catalog',$2)",[actor.userId,JSON.stringify({item_id:row.id,before:{name:item.name,lines:context.lines},after:{name:row.name,entries:normalized.entries,prices,costs},counts_confirmed:false})]);
        return present(await contextFor(client,row.id,actor.branchId),actor);
      });
    },

    async review(itemIds, actor) {
      const units=await selectedUnits(itemIds,actor.branchId),results=[];
      for(const unit of units) {
        try { if(unit.item_ids.some(id=>!itemIds.includes(id))) throw DomainError.conflict('Select the complete linked product before reviewing.'); const result=await repository.withTransaction(client=>reviewUnit(client,unit,actor));const {contexts,...safe}=result;results.push(safe); }
        catch(error) {results.push({unit,item_ids:unit.item_ids,error:error instanceof DomainError?error.message:'Unable to review this product. Retry review.'});}
      }
      return {results};
    },

    /** Validate the reviewed snapshot, confirm quantities and receive stock in the same transaction; retry returns the receipt. */
    async send(review, actor) {
      const result=await repository.withTransaction(async client=>{
        const checked=await reviewUnit(client,review.unit,actor);
        if(checked.already_received) return checked;
        if(checked.revision!==review.revision) throw DomainError.conflict('Items or POS prices changed. Return to pricing and review again.');
        for(const context of checked.contexts) await client.query("UPDATE inventory.items SET stock_distribution_source='human_confirmed',updated_by=$2 WHERE id=$1",[context.item.id,actor.userId]);
        if(review.unit.group) {
          const fresh=await matching.receive({...actor,id:review.unit.id,transactionClient:client});
          await matching.receive({...actor,id:review.unit.id,expectedRevision:fresh.revision,apply:true,transactionClient:client});
        } else {
          const itemId=review.unit.item_ids[0],fresh=await contextFor(client,itemId,actor.branchId);
          await publishCatalogItem({...actor,itemId,expectedRevision:createPublicationRevision(fresh,actor),transactionClient:client});
        }
        await client.query("INSERT INTO user_audit_logs(user_id,action,module,description) VALUES($1,'catalog.delivery.send','catalog',$2)",[actor.userId,JSON.stringify({item_ids:checked.item_ids,quantities_confirmed_on_send:true,review:review.revision})]);
        return {item_ids:checked.item_ids,received:true};
      });
      result.photo_pending=0;
      for(const itemId of result.item_ids) {
        try {const photo=await transferCatalogPhoto({...actor,itemId,appendGallery:review.unit.group});if(!['linked','preserved'].includes(photo?.status)) result.photo_pending++;}
        catch(error) {result.photo_pending++;console.error('Delivery received; photo handoff pending.',{itemId,errorName:error.name});}
      }
      return result;
    },
  };
}
module.exports = { createDeliveryCheckout };
