const { createWorkspaceRouter } = require('./workspace-router.cjs');
const { loadPosDependencies } = require('./pos-dependencies.cjs');

/** Mountable runtime factory: reuse the host POS installation, without a sibling checkout dependency. */
function createPosWorkspaceRouter(backendPath) {
  return createWorkspaceRouter(loadPosDependencies(backendPath));
}

module.exports = { createPosWorkspaceRouter };
