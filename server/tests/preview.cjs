const { configureTestEnvironment } = require('./environment.cjs');
const dependencies = configureTestEnvironment();
const { installLocalImageStore } = require('./local-images.cjs');
const serveImage = installLocalImageStore(dependencies);
const { createLocalHost } = require('../local-host.cjs');
const app = dependencies.posRequire('express')();
app.get('/test-images', serveImage);
app.use(createLocalHost(dependencies));
app.listen(5109, '127.0.0.1', () => console.log('K-Line local POS integration: http://127.0.0.1:5109'));
