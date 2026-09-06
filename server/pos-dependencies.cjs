const { createRequire } = require('node:module');
const path = require('node:path');

/** Load one explicit POS installation; this adapter never duplicates its identity or stock engine. */
function loadPosDependencies(backendPath = process.env.POS_BACKEND_PATH) {
  if (!backendPath) throw new Error('Set POS_BACKEND_PATH to the existing POS backend directory.');
  const root = path.resolve(backendPath);
  const posRequire = createRequire(path.join(root, 'package.json'));
  const source = (relative) => posRequire(path.join(root, 'src', relative));
  return { root, posRequire, source };
}
module.exports = { loadPosDependencies };
