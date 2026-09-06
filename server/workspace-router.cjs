const { createWorkspaceService } = require('./workspace-service.cjs');
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Reuse POS authentication, effective permissions and branch resolution on every new route. */
function createWorkspaceRouter(dependencies) {
  const { source, posRequire } = dependencies;
  const router = posRequire('express').Router();
  const { authenticate } = source('middleware/auth');
  const { checkPermission, attachPermissions } = source('middleware/permissions');
  const { resolveBranchContext } = source('middleware/branchContext');
  const DomainError = source('errors/DomainError');
  const service = createWorkspaceService(dependencies);
  const uuid = (value) => {
    if (!UUID.test(String(value))) throw DomainError.validationFailed('Invalid identifier.');
    return value;
  };
  const text = (value, max = 120) => {
    if (typeof value !== 'string' || value.trim().length > max)
      throw DomainError.validationFailed('Invalid text value.');
    return value.trim();
  };
  const page = (value) => {
    const result = Number(value || 1);
    if (!Number.isSafeInteger(result) || result < 1 || result > 100000)
      throw DomainError.validationFailed('Invalid page.');
    return result;
  };
  const reply = (action) => async (req, res, next) => {
    try {
      res.json(await action(req));
    } catch (error) {
      next(error);
    }
  };
  const choice = (value,allowed) => {
    if(!allowed.includes(value))throw DomainError.validationFailed('Invalid filter choice.');
    return value;
  };
  router.use(
    authenticate,
    checkPermission('catalog.view'),
    resolveBranchContext({ required: true, allowedStatuses: ['active'] }),
    attachPermissions(),
  );
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/category-mappings', checkPermission('settings.categories'), reply(() => service.categoryMappings()));
  router.post('/items/:id/ai-recovery',checkPermission('catalog.edit'),reply(req=>
    service.recoverAi({itemId:uuid(req.params.id),branchId:req.branchId,userId:req.user.id})));
  router.post('/intake/:id/cancellation',checkPermission('catalog.delete'),reply(req=>{
    const reason=text(req.body.reason,300);if(!reason)throw DomainError.validationFailed('Enter a reason.');
    return service.changeIntakeCancellation({itemId:uuid(req.params.id),branchId:req.branchId,userId:req.user.id,reason,
      restore:choice(req.body.action,['cancel','restore'])==='restore',expectedRevision:req.body.expected_revision});
  }));
  router.get('/items/:id/activity',reply(req=>service.itemActivity({itemId:uuid(req.params.id),branchId:req.branchId,page:page(req.query.page),canViewCost:new Set(req.user.permissions||[]).has('catalog.view_cost')})));
  router.get('/items/:id/restock-options',checkPermission('catalog.publish'),checkPermission('products.view'),reply(req =>
    service.restockOptions({itemId:uuid(req.params.id),branchId:req.branchId,search:text(req.query.search || '',120)})));
  router.post('/items/:id/restock/:action',checkPermission('catalog.publish'),checkPermission('products.view'),reply(req => {
    // Require complete reviewed identities and never infer a product/variant merge from names or sizes.
    if (!['review','receive'].includes(req.params.action)) throw DomainError.notFound('Restock action unavailable.');
    if (!Array.isArray(req.body.matches) || !req.body.matches.length || req.body.matches.length>100 || req.body.matches.some(row => !row || typeof row!=='object'))
      throw DomainError.validationFailed('Match the incoming sizes.');
    return service.restockItem({itemId:uuid(req.params.id),productId:uuid(req.body.product_id),branchId:req.branchId,userId:req.user.id,
      matches:req.body.matches.map(row => ({line_id:uuid(row.line_id),variant_id:uuid(row.variant_id)})),
      expectedRevision:req.body.expected_revision,apply:req.params.action==='receive'});
  }));
  router.put('/category-mappings/:id', checkPermission('settings.categories'), reply(req =>
    service.saveCategoryMapping({categoryId:uuid(req.params.id),posCategoryId:uuid(req.body.pos_category_id),
      userId:req.user.id,expectedRevision:text(req.body.expected_revision,64)})));
  router.get(
    '/pricing-history',
    checkPermission('catalog.edit'),
    reply((req) => service.pricingHistory(req.branchId, req.user.id, page(req.query.page))),
  );
  router.get(
    '/history/:kind',
    reply((req) => {
      if (!['receipts', 'deliveries'].includes(req.params.kind)) throw DomainError.notFound('History unavailable.');
      return service.history(req.branchId, req.params.kind, {
        page: page(req.query.page), search: text(req.query.search || '', 200),
        batchId: req.query.batch_id ? uuid(req.query.batch_id) : null,
      });
    }),
  );
  // Compatibility routes are removal candidates once older clients no longer depend on array responses.
  router.get(
    '/batches',
    reply((req) => service.listBatches(req.branchId)),
  );
  router.post(
    '/batches',
    checkPermission('catalog.upload'),
    reply((req) => {
      const title = text(req.body.title);
      if (!title) throw DomainError.validationFailed('Name this delivery.');
      return service.createBatch({
        id: uuid(req.body.id),
        branchId: req.branchId,
        userId: req.user.id,
        title,
      });
    }),
  );
  router.put(
    '/batches/:id/items/:itemId',
    checkPermission('catalog.upload'),
    reply((req) =>
      service.addBatchItem({
        batchId: uuid(req.params.id),
        itemId: uuid(req.params.itemId),
        branchId: req.branchId,
        userId: req.user.id,
      }),
    ),
  );
  router.get(
    '/items',
    reply((req) =>
      service.listItems(req.branchId, {
        page: page(req.query.page),
        search: text(req.query.search || '', 200),
        batchId: req.query.batch_id ? uuid(req.query.batch_id) : null,
        categoryId:req.query.category_id ? uuid(req.query.category_id) : undefined,
        receivingTask:choice(req.query.task || 'all',['all','incoming','count','price','flagged','received','reconcile','cancelled']),
        sortBy:choice(req.query.sort || 'newest',['newest','oldest','name']),
      }),
    ),
  );
  router.get(
    '/items/:id',
    reply((req) => service.itemDetail(req.branchId, uuid(req.params.id), req.user.id)),
  );
  router.post(
    '/items/:id/receive',
    checkPermission('catalog.publish'),
    reply((req) => {
      /* Require a reviewed snapshot at this boundary; POS verifies it inside the receipt transaction. */
      const expectedRevision = req.body?.expected_revision;
      if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision))
        throw DomainError.validationFailed('A valid receiving review is required.');
      return service.receiveItem({
        itemId: uuid(req.params.id),
        branchId: req.branchId,
        userId: req.user.id,
        expectedRevision,
      });
    }),
  );
  router.post(
    '/items/:id/photo',
    checkPermission('catalog.publish'),
    reply((req) => service.transferPhoto({ itemId: uuid(req.params.id), branchId: req.branchId, userId: req.user.id })),
  );
  router.patch(
    '/items/:id',
    checkPermission('catalog.edit'),
    reply((req) => {
      /* Validate draft identifiers and scalar fields before delegating the revision-checked edit. */

      const payload = {
        ...req.body,
        name: text(req.body.name, 250),
        brand: text(req.body.brand || '', 150),
        category_id: uuid(req.body.category_id),
      };
      if (!payload.attributes || typeof payload.attributes !== 'object' || Array.isArray(payload.attributes))
        throw DomainError.validationFailed('Invalid product attributes.');
      return service.updateDetails({
        branchId: req.branchId,
        itemId: uuid(req.params.id),
        userId: req.user.id,
        payload,
      });
    }),
  );
  router.patch(
    '/items/:id/count',
    checkPermission('catalog.edit'),
    reply((req) =>
      service.confirmCount({
        branchId: req.branchId,
        itemId: uuid(req.params.id),
        userId: req.user.id,
        payload: req.body,
      }),
    ),
  );
  // Current availability requires inventory.view in addition to catalog access.
  router.get(
    '/stock',
    checkPermission('inventory.view'),
    reply((req) => {
      /* Allow only supported stock states and bounded search, size and pagination inputs. */

      const state = req.query.state || 'all';
      if (!['all', 'in', 'low', 'out', 'negative'].includes(state))
        throw DomainError.validationFailed('Invalid stock filter.');
      return service.stock(req.branchId, {
        search: text(req.query.search || '', 200),
        size: text(req.query.size || '', 100),
        categoryId: req.query.category_id ? uuid(req.query.category_id) : null,
        brandId: req.query.brand_id ? uuid(req.query.brand_id) : null,
        state,
        page: page(req.query.page),
      });
    }),
  );
  router.get(
    '/stock/:id/movements',
    checkPermission('inventory.view'),
    reply((req) => service.movements(req.branchId, uuid(req.params.id))),
  );
  router.get(
    '/receipts',
    reply((req) => service.receipts(req.branchId, req.query.batch_id ? uuid(req.query.batch_id) : null)),
  );
  router.use((error, _req, res, _next) => {
    if (error instanceof DomainError)
      return res.status(error.statusCode).json({ message: error.message, details: error.details });
    console.error('Workspace request failed:', error.message);
    return res.status(500).json({ message: 'The workspace service could not complete this request.' });
  });
  return router;
}
module.exports = { createWorkspaceRouter };
