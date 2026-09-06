const { createHmac } = require('node:crypto');
const { createWorkspaceRepository } = require('./workspace-repository.cjs');

/** Sign a full edit snapshot, including line changes, without exposing protected costs. */
function revisionOf(context) {
  if (!process.env.JWT_SECRET) throw new Error('POS JWT_SECRET is required.');
  return createHmac('sha256', process.env.JWT_SECRET).update(JSON.stringify(context)).digest('hex');
}

/** Compose the workspace from authoritative POS services and narrowly scoped repository reads. */
function createWorkspaceService({ source }) {
  const { pool } = source('config/database');
  const DomainError = source('errors/DomainError');
  const publicationRepository = source('repositories/CatalogPublicationRepository');
  const { catalogPublicationBlockers, createPublicationRevision, publishCatalogItem } = source(
    'services/catalogPublicationService',
  );
  if (typeof createPublicationRevision !== 'function')
    throw new Error('This workspace requires the POS pinned receiving review contract (ADR-073).');
  const { listCatalogItems } = source('services/catalogReadService');
  const { createCatalogImageUrl } = source('services/catalogImageStorageService');
  const { createProductImageUrl } = source('utils/productImageStorage');
  const { readPhotoHandoff, transferCatalogPhoto } = source('services/catalogPhotoHandoffService');
  const { normalizeCatalogStockDistribution, expandCatalogSizeLabel } = source(
    'utils/catalogStockDistribution',
  );
  const CatalogVariantLine = source('models/CatalogVariantLine');
  const repository = createWorkspaceRepository({ pool, publicationRepository });
  const published = (context) => !!(context.item.publication_id || context.item.pos_product_id);
  async function requireContext(client, itemId, branchId) {
    const context = await publicationRepository.loadLockedContext(client, { itemId, branchId });
    if (!context) throw DomainError.notFound('This item is unavailable in this branch.');
    return context;
  }
  return {
    async categoryMappings() {
      const result = await repository.categoryMappings();
      return { ...result, categories: result.categories.map(row => ({ ...row, revision: revisionOf(row) })) };
    },
    async saveCategoryMapping({categoryId,posCategoryId,userId,expectedRevision}) {
      // Lock the category before rereading its mapping so waiting writers cannot use an old joined snapshot.
      return repository.transaction(async client => {
        const category = await client.query('SELECT id FROM inventory.categories WHERE id=$1 AND active=true FOR UPDATE',[categoryId]);
        if (!category.rowCount) throw DomainError.notFound('Catalog category unavailable.');
        const before = (await repository.categoryMappings(client)).categories.find(row => row.id === categoryId);
        if (revisionOf(before) !== expectedRevision) throw DomainError.conflict('This mapping changed. Reload mappings before saving.');
        const target = await client.query('SELECT id FROM categories WHERE id=$1 AND is_active=true FOR SHARE',[posCategoryId]);
        if (!target.rowCount) throw DomainError.validationFailed('Choose an active POS category.');
        await repository.saveCategoryMapping(client,{categoryId,posCategoryId,userId,before});
        return { saved: true };
      });
    },
    pricingHistory: (branchId, userId, page) => repository.pricingHistory(branchId, userId, page),
    async history(branchId, kind, { page, search, batchId }) {
      // Bound response size while preserving stable ordering and search across the complete history.
      const options = { search, limit: 24, offset: (page - 1) * 24 };
      const read = (parameters) => kind === 'receipts'
        ? repository.receipts(branchId, batchId, parameters)
        : repository.listBatches(branchId, parameters);
      const rows = await read(options);
      const total = rows[0]?.total_count ?? (page > 1 ? (await read({ ...options, offset: 0, limit: 1 }))[0]?.total_count || 0 : 0);
      return { items: rows, total, page, limit: 24 };
    },
    listBatches: (branchId) => repository.listBatches(branchId),
    async createBatch(input) {
      const result = await repository.createBatch(input);
      if (!result) throw DomainError.conflict('This delivery identifier is already in use.');
      return result;
    },
    /** Bound each page and return authoritative blockers without serializing internal cost values. */
    async listItems(branchId, { page = 1, search = '', batchId = null }) {
      // Batch IDs are looked up inside the authorized branch before any item read.
      const itemIds = batchId ? await repository.batchItemIds(branchId, batchId) : undefined;
      const result = await listCatalogItems({
        branchId,
        itemIds,
        search,
        limit: 48,
        offset: (page - 1) * 48,
      });
      const memberships = await repository.itemMemberships(
        branchId,
        result.items.map((item) => item.id),
      );
      const items = [];
      for (const item of result.items) {
        const metadata = await repository.transaction(async (client) => {
          const context = await requireContext(client, item.id, branchId);
          return {
            revision: revisionOf(context),
            blockers: published(context) ? [] : catalogPublicationBlockers(context),
          };
        });
        const membership = memberships.find((entry) => entry.item_id === item.id);
        items.push({
          ...item,
          ...metadata,
          batch_id: membership?.batch_id || null,
          batch_title: membership?.batch_title || null,
        });
      }
      return { ...result, items, page, limit: 48 };
    },
    async itemDetail(branchId, itemId, userId) {
      /* Return safe item fields and the signed revision from one locked preparation snapshot. */

      return repository.transaction(async (client) => {
        /* Keep protected cost values inside the publication context, never in the detail projection. */

        const context = await requireContext(client, itemId, branchId);
        const fields = await repository.categoryFields(client, context.item.category_id);
        const { item, lines } = context;
        return {
          revision: revisionOf(context),
          publication_revision: createPublicationRevision(context, { branchId, userId }),
          fields,
          blockers: published(context) ? [] : catalogPublicationBlockers(context),
          item: {
            photo_handoff: await readPhotoHandoff(branchId, itemId, client),
            id: item.id,
            name: item.name,
            brand: item.brand,
            category_id: item.category_id,
            attributes: item.attributes,
            confidence: item.confidence || {},
            ai_field_evidence: item.ai_field_evidence || {},
            ai_visible_text: item.ai_visible_text || null,
            ai_run: await repository.latestAiRun(client, itemId),
            status: item.status,
            image_url: await createCatalogImageUrl(item.image_path),
            is_published: published(context),
            stock_quantity: item.stock_quantity,
            stock_distribution_source: item.stock_distribution_source,
            price: item.price === null ? null : Number(item.price),
            variant_lines: lines.map((line) => ({
              id: line.id,
              variant_attributes: line.variant_attributes,
              quantity: Number(line.quantity),
              effective_price:
                (line.price_override ?? item.price) === null
                  ? null
                  : Number(line.price_override ?? item.price),
            })),
          },
        };
      });
    },
    async receiveItem(input) {
      // Receipt commits first. Even a database outage during image recovery cannot undo its success.
      const receipt = await publishCatalogItem(input);
      let photo_handoff = { status: 'pending' };
      try {
        photo_handoff = await transferCatalogPhoto(input);
      } catch (error) {
        console.error('Received stock; photo handoff needs retry:', error.message);
      }
      return { ...receipt, photo_handoff };
    },
    transferPhoto: (input) => transferCatalogPhoto(input),
    /** Reject stale or published edits; category-defined values remain sparse and auditable. */
    async updateDetails({ branchId, itemId, userId, payload }) {
      return repository.transaction(async (client) => {
        /* Reject stale or published edits, validate category fields and record the identity change atomically. */

        const context = await requireContext(client, itemId, branchId);
        if (published(context)) throw DomainError.conflict('Received product details are owned by POS.');
        if (revisionOf(context) !== payload.expected_revision)
          throw DomainError.conflict('This item changed. Reopen it before saving.');
        const categoryId = payload.category_id;
        if (!(await repository.activeCategory(client, categoryId)))
          throw DomainError.validationFailed('Choose an active category.');
        const fields = await repository.categoryFields(client, categoryId);
        const attributes = { ...context.item.attributes };
        for (const [key, value] of Object.entries(payload.attributes || {})) {
          const field = fields.find((entry) => entry.key === key);
          if (!field) throw DomainError.validationFailed(`Unknown category field: ${key}.`);
          if (
            value !== null &&
            (!['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 1000)
          )
            throw DomainError.validationFailed(`Invalid ${field.label}.`);
          if (value !== null && value !== '' && field.type === 'number' && !Number.isFinite(Number(value)))
            throw DomainError.validationFailed(`${field.label} must be a number.`);
          if (value !== null && value !== '' && field.type === 'boolean' && typeof value !== 'boolean')
            throw DomainError.validationFailed(`${field.label} must be true or false.`);
          if (
            value !== null &&
            value !== '' &&
            field.type === 'select' &&
            field.options?.length &&
            !field.options.includes(String(value))
          )
            throw DomainError.validationFailed(`Choose a listed ${field.label}.`);
          attributes[key] = value;
        }
        const before = {
          status: context.item.status,
          name: context.item.name,
          brand: context.item.brand,
          category_id: context.item.category_id,
          attributes: context.item.attributes,
        };
        const reviewableKeys = [
          'name',
          'brand',
          ...fields.filter((field) => field.key !== 'size').map((field) => field.key),
        ];
        const reviewedAiFields = payload.review_ai_fields || [];
        if (!Array.isArray(reviewedAiFields) || reviewedAiFields.some((key) => !reviewableKeys.includes(key)))
          throw DomainError.validationFailed('Invalid AI review fields.');
        const after = {
          status: payload.hold_for_photo === true ? 'flag' : payload.resolve_flag === true ? 'draft' : context.item.status,
          ...(payload.hold_for_photo === true ? { hold_reason: 'Photo or label needs checking' } : {}),
          name: payload.name,
          brand: payload.brand,
          category_id: categoryId,
          attributes,
          reviewed_ai_fields: reviewedAiFields,
        };
        const changedFields = reviewableKeys.filter((key) => {
          const oldValue =
            key === 'name' || key === 'brand' ? context.item[key] : context.item.attributes?.[key];
          const newValue = key === 'name' || key === 'brand' ? payload[key] : attributes[key];
          return JSON.stringify(oldValue ?? null) !== JSON.stringify(newValue ?? null);
        });
        await repository.updateDetails(client, {
          itemId,
          branchId,
          userId,
          ...after,
          categoryId,
          resolveFlag: payload.resolve_flag === true,
          holdForPhoto: payload.hold_for_photo === true,
          clearConfidence: [...new Set([...reviewedAiFields, ...changedFields])],
        });
        await repository.recordEdit(client, { itemId, userId, before, after });
        return { saved: true };
      });
    },
    async addBatchItem(input) {
      /* Lock the item and delivery before creating an immutable, branch-safe membership. */

      return repository.transaction(async (client) => {
        const context = await requireContext(client, input.itemId, input.branchId);
        if (published(context)) throw DomainError.conflict('Received items cannot change delivery.');
        const membership = await repository.addBatchItem(client, input);
        if (!membership) throw DomainError.notFound('Delivery not found in this branch.');
        if (membership !== input.batchId)
          throw DomainError.conflict('This item already belongs to another delivery.');
        return { added: true };
      });
    },
    /** Compare the same locked revision before replacing quantities; published receipt evidence stays immutable. */
    async confirmCount({ itemId, branchId, userId, payload }) {
      return repository.transaction(async (client) => {
        /* Compare the locked revision before normalizing, saving and auditing the physical size counts. */

        const context = await requireContext(client, itemId, branchId);
        if (published(context)) throw DomainError.conflict('Received stock is owned by POS.');
        if (revisionOf(context) !== payload.expected_revision)
          throw DomainError.conflict('This item changed. Reopen it before confirming quantities.');
        if (
          Array.isArray(payload.entries) &&
          payload.entries.some((entry) => expandCatalogSizeLabel(entry?.variant_attributes?.size).length > 1)
        )
          throw DomainError.validationFailed('Enter each size on its own row.');
        const normalized = normalizeCatalogStockDistribution(payload.entries, {
          allowedAttributeKeys: new Set(context.fields.filter((f) => f.key === 'size').map((f) => f.key)),
        });
        if (normalized.entries.length !== payload.entries.length)
          throw DomainError.validationFailed('Combine duplicate sizes on one row.');
        await repository.saveCount(client, { itemId, branchId, userId, ...normalized });
        await CatalogVariantLine.replaceDistribution(client, { itemId, entries: normalized.entries, userId });
        await repository.recordEdit(client, {
          itemId,
          userId,
          before: { entries: context.item.stock_distribution },
          after: { entries: normalized.entries, total_quantity: normalized.totalQuantity },
        });
        return { saved: true, total_units: normalized.totalQuantity };
      });
    },
    /** Missing responses stay errors; a successful stock read is timestamped after its query completes. */
    async stock(branchId, filters) {
      const rows = await repository.readStock(branchId, filters);
      const images = await repository.stockImages(
        branchId,
        rows.map((row) => row.product_id),
      );
      const products = await Promise.all(
        rows.map(async (row) => {
          /* Sign one product image and serialize only POS quantities and selling prices. */

          const photo = images.find((image) => image.id === row.product_id);
          const image_url = photo?.catalog_image_path
            ? await createCatalogImageUrl(photo.catalog_image_path)
            : photo?.pos_image_path
              ? await createProductImageUrl(photo.pos_image_path)
              : null;
          const { total, ...product } = row;
          return {
            ...product,
            image_url,
            variants: row.variants.map((line) => ({
              ...line,
              effective_price: Number(line.effective_price),
            })),
          };
        }),
      );
      return {
        products,
        total: rows[0]?.total || 0,
        page: filters.page,
        limit: 48,
        updated_at: new Date().toISOString(),
        sizes: await repository.stockSizes(),
        ...(await repository.stockFilterChoices()),
      };
    },
    movements: (branchId, productId) => repository.stockMovements(branchId, productId),
    receipts: (branchId, batchId) => repository.receipts(branchId, batchId),
  };
}
module.exports = { createWorkspaceService };
