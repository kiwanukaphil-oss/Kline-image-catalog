import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  // Exercise a real browser decoder and camera stream while intercepting only the final stock-photo upload.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'New delivery', exact: true }).click();
  const picker = page.getByLabel('Delivery photos');
  const small = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 30;
      c.height = 30;
      const x = c.getContext('2d');
      x.fillStyle = 'navy';
      x.fillRect(0, 0, 30, 30);
      return c.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );
  await picker.setInputFiles([
    { name: 'shirt.png', mimeType: 'image/png', buffer: small },
    { name: 'shirt-again.png', mimeType: 'image/png', buffer: small },
  ]);
  await page.getByText('Similar to another photo', { exact: true }).waitFor();
  assert.equal(await page.getByRole('img').count(), 2);
  const large = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 1700;
      c.height = 1700;
      const x = c.getContext('2d'),
        data = x.createImageData(1700, 1700);
      let seed = 42;
      for (let i = 0; i < data.data.length; i += 4) {
        seed = (1664525 * seed + 1013904223) >>> 0;
        data.data[i] = seed & 255;
        data.data[i + 1] = (seed >>> 8) & 255;
        data.data[i + 2] = (seed >>> 16) & 255;
        data.data[i + 3] = 255;
      }
      x.putImageData(data, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );
  assert(large.length > 5 * 1024 * 1024);
  await picker.setInputFiles({ name: 'large-phone.png', mimeType: 'image/png', buffer: large });
  await page.getByText('Resized for upload', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  const camera = page.getByRole('dialog', { name: 'Capture merchandise', exact: true });
  await camera.getByRole('button', { name: 'Take photo', exact: true }).click();
  await camera.getByText('1 photos captured', { exact: true }).waitFor();
  await camera.getByRole('button', { name: 'Take photo', exact: true }).click();
  await camera.getByText('2 photos captured', { exact: true }).waitFor();
  await page.evaluate(
    () => (window.intakeTestTrack = document.querySelector('video').srcObject.getVideoTracks()[0]),
  );
  await camera.getByRole('button', { name: 'Done', exact: true }).click();
  assert.equal(await page.evaluate(() => window.intakeTestTrack.readyState), 'ended');
  await page.screenshot({ path: '../verification/phone-intake-mobile.png', animations: 'disabled' });
  await page.route('**/api/catalog/items', (route) => route.abort());
  await page.getByRole('button', { name: 'Add to Receiving', exact: true }).click();
  await page.getByRole('button', { name: 'Resume uploads', exact: true }).waitFor();
  const saved = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('kline-receiving', 1);
        open.onerror = reject;
        open.onsuccess = () => {
          const db = open.result,
            req = db.transaction('pending-photos').objectStore('pending-photos').getAll();
          req.onsuccess = () => {
            resolve(req.result.map((row) => ({ name: row.file.name, size: row.file.size })));
            db.close();
          };
        };
      }),
  );
  assert.equal(saved.length, 5);
  assert(saved.every((row) => row.size <= 5 * 1024 * 1024));
  assert.equal(saved.find((row) => row.name === 'shirt.png').size, small.length);
  assert.equal(
    await page.getByRole('img').count(),
    0,
    'Queued choices leave the selection to prevent accidental duplicate upload',
  );
  await fs.writeFile(
    '../verification/phone-intake.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Similar shots retained with warning',
          'Large real PNG resized under POS limit',
          'Ordinary photo bytes retained',
          'Two consecutive camera shots',
          'Camera track released on Done',
          'All five choices persisted for retry',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS phone selection, large image, burst capture and durable retry');
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
