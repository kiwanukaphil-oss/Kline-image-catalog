import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  context = await browser.newContext({ viewport: { width: 390, height: 844 } }),
  page = await context.newPage();
try {
  // Use the real installed service worker and IndexedDB; shared photos wait for authenticated delivery review.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const manifest = await page.evaluate(async () => await (await fetch('/manifest.webmanifest')).json());
  assert.equal(manifest.share_target.action, '/share-intake');
  for (const icon of manifest.icons)
    assert.equal((await page.request.get(new URL(icon.src, page.url()).href)).status(), 200);
  const url = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 40;
    const x = canvas.getContext('2d');
    x.fillStyle = 'navy';
    x.fillRect(0, 0, 40, 40);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')),
      form = new FormData();
    form.append('photos', new File([blob], 'Shared-shirt.png', { type: 'image/png' }));
    return (await fetch('/share-intake', { method: 'POST', body: form })).url;
  });
  assert(new URL(url).searchParams.get('share'));
  await page.goto(url);
  await page.getByRole('dialog', { name: 'New delivery', exact: true }).waitFor();
  await page.getByRole('img', { name: 'Shared-shirt.png', exact: true }).waitFor();
  await page.screenshot({ path: '../verification/pwa-share-mobile.png', animations: 'disabled' });
  const cached = await page.evaluate(async () => {
    const result = [];
    for (const key of await caches.keys()) {
      for (const entry of await (await caches.open(key)).keys()) result.push(new URL(entry.url).pathname);
    }
    return result;
  });
  assert.deepEqual(cached, ['/offline.html']);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('heading', { name: "You're offline", exact: true }).waitFor();
  assert.equal(
    new URL(
      await page.getByRole('link', { name: 'Try again' }).getAttribute('href'),
      page.url(),
    ).searchParams.get('share'),
    new URL(url).searchParams.get('share'),
  );
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Try again' }).click();
  await page.getByRole('img', { name: 'Shared-shirt.png', exact: true }).waitFor();
  await page.route('**/api/catalog/items', (route) => route.abort());
  await page.getByRole('button', { name: 'Add to Receiving', exact: true }).click();
  await page.getByRole('button', { name: 'Resume uploads', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('share'), false);
  await fs.writeFile(
    '../verification/pwa-share.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Manifest and both install icons load',
          'Real share POST persists local photo',
          'Authenticated delivery opens for deliberate review',
          'Only static offline notice cached',
          'Offline reload preserves share intent',
          'Reconnect restores photo',
          'Share consumed only after upload queue commits',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS PWA share, local persistence, private-data cache exclusion and offline recovery');
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
