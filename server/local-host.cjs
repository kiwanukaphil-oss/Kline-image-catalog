const { loadPosDependencies } = require('./pos-dependencies.cjs');
const { createWorkspaceRouter } = require('./workspace-router.cjs');

/** Compose isolated integration using the adjacent POS backend. Production mounts the exported router. */
function createLocalHost(dependencies = loadPosDependencies()) {
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.DB_NAME !== 'kline_catalog_workspace_test' ||
    !['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST) ||
    process.env.DATABASE_PUBLIC_URL ||
    process.env.DATABASE_URL
  )
    throw new Error('The local host only supports the dedicated local K-Line test database.');
  const { posRequire, source } = dependencies;
  const express = posRequire('express');
  const app = express();
  app.use(posRequire('helmet')());
  const origins = (process.env.CORS_ORIGINS || 'http://localhost:5198,http://127.0.0.1:5198').split(',');
  app.use(
    posRequire('cors')({
      origin: (origin, callback) => callback(null, !origin || origins.includes(origin)),
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Branch-Id'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(
    '/api/catalog-workspace',
    posRequire('express-rate-limit').rateLimit({ windowMs: 60000, limit: 300 }),
    createWorkspaceRouter(dependencies),
  );
  app.use(source('server'));
  return app;
}
if (require.main === module) {
  if (process.env.NODE_ENV !== 'test')
    throw new Error(
      'This host is for isolated local integration only. Mount workspace-router in POS for production.',
    );
  createLocalHost().listen(Number(process.env.PORT || 5109), '127.0.0.1', () =>
    console.log('K-Line integration listening on 127.0.0.1:5109'),
  );
}
module.exports = { createLocalHost };
