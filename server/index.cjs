const { createWorkspaceRouter } = require('./workspace-router.cjs');
const { loadPosDependencies } = require('./pos-dependencies.cjs');

/** Mountable runtime factory: reuse the host POS installation, without a sibling checkout dependency. */
function createPosWorkspaceRouter(backendPath) {
  const dependencies = loadPosDependencies(backendPath);
  const router = createWorkspaceRouter(dependencies);
  if (process.env.NODE_ENV !== 'test') require('./ai-batches.cjs').startAiBatchWorker(dependencies);
  return router;
}

module.exports = { createPosWorkspaceRouter };
