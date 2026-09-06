const fs = require('node:fs/promises');
const path = require('node:path');
const { createHmac, timingSafeEqual } = require('node:crypto');
const imageRoot = path.resolve(__dirname, '../../.test-data/images');

/** Exercise real image bytes with expiring URLs without contacting the production bucket. */
function installLocalImageStore(dependencies) {
  if (process.env.NODE_ENV !== 'test' || process.env.DB_NAME !== 'kline_catalog_workspace_test')
    throw new Error('Local images are test-only.');
  const imagePath = (key) => {
    const target = path.resolve(imageRoot, key);
    if (!target.startsWith(imageRoot + path.sep)) throw new Error('Invalid local image key.');
    return target;
  };
  const sign = (value) => createHmac('sha256', process.env.JWT_SECRET).update(value).digest('hex');
  const modulePath = path.join(dependencies.root, 'src/services/catalogImageStorageService.js');
  const original = dependencies.posRequire(modulePath);
  dependencies.posRequire.cache[dependencies.posRequire.resolve(modulePath)].exports = {
    ...original,
    async createCatalogImageUrl(key) {
      if (!key) return null;
      imagePath(key);
      const expires = Date.now() + 900000;
      return `http://127.0.0.1:5109/test-images?key=${encodeURIComponent(key)}&expires=${expires}&signature=${sign(key + ':' + expires)}`;
    },
    async storeCatalogImage({ objectKey, buffer }) {
      const target = imagePath(objectKey);
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.writeFile(target, buffer, { flag: 'wx' });
        return { created: true };
      } catch (error) {
        if (error.code === 'EEXIST') return { created: false };
        throw error;
      }
    },
    async deleteCatalogImage(key) {
      await fs.unlink(imagePath(key));
    },
  };
  // POS copies use the same private-key signing fixture, including POS-only stock projections.
  const productImages = dependencies.source('utils/productImageStorage');
  productImages.createProductImageUrl = dependencies.posRequire(modulePath).createCatalogImageUrl;
  return async function serveLocalImage(req, res) {
    const { key, expires, signature } = req.query;
    if (
      typeof key !== 'string' ||
      typeof signature !== 'string' ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      Number(expires) < Date.now() ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(key + ':' + expires)))
    )
      return res.sendStatus(403);
    try {
      res.set('Cache-Control', 'private, max-age=60');
      res.sendFile(imagePath(key), { dotfiles: 'allow' });
    } catch {
      res.sendStatus(404);
    }
  };
}
module.exports = { installLocalImageStore };
