const dependencies = require('./environment.cjs').configureTestEnvironment();
require('./local-images.cjs').installLocalImageStore(dependencies);
process.env.CATALOG_AI_ENABLED='true';
process.env.OPENAI_API_KEY='local-fixture-not-a-real-key';
process.env.OPENAI_MAX_ATTEMPTS='1';
require('./ai-batch-provider.cjs').installBatchProvider({delay:60000,onCall:()=>process.send?.('provider-started')});
const { pool } = dependencies.source('config/database');
require('../ai-batches.cjs').createAiBatchService(dependencies).runOne()
  .then(()=>process.send?.('finished')).finally(()=>pool.end()).catch(error=>{console.error(error.message);process.exitCode=1;});
