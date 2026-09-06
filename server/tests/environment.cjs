const fs = require('node:fs');
const path = require('node:path');
const { loadPosDependencies } = require('../pos-dependencies.cjs');

/** Tests own a new local database; inherited Railway URLs are explicitly excluded. */
function configureTestEnvironment() {
  const dependencies = loadPosDependencies(
    process.env.POS_BACKEND_PATH || 'C:/Projects/inventory-pos-system/backend',
  );
  const parsed = dependencies
    .posRequire('dotenv')
    .parse(fs.readFileSync(path.join(dependencies.root, '.env.test')));
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD']) process.env[key] = parsed[key];
  if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST))
    throw new Error('Integration tests require local PostgreSQL.');
  // Empty values also prevent a later dotenv load from injecting a remote connection URL.
  process.env.DATABASE_PUBLIC_URL = '';
  process.env.DATABASE_URL = '';
  process.env.DB_NAME = 'kline_catalog_workspace_test';
  process.env.NODE_ENV = 'test';
  process.env.DB_SSL = 'false';
  process.env.JWT_SECRET = 'kline-disposable-local-test-signing-key-not-for-production';
  process.env.CORS_ORIGINS = 'http://127.0.0.1:5198,http://localhost:5198,http://[::1]:5198,http://127.0.0.1:3000';
  process.env.CATALOG_AI_ENABLED = 'false';
  process.env.CATALOG_WORKSPACE_ENABLED = 'true';
  process.env.BRANCH_MODE = 'active';
  process.env.POS_BACKEND_PATH = dependencies.root;
  return dependencies;
}
module.exports = { configureTestEnvironment };
