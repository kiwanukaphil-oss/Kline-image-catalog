import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { configureTestEnvironment } from '../../server/tests/environment.cjs';
const { source } = configureTestEnvironment(),
  { pool } = source('config/database');
const id = randomUUID(),
  queued = randomUUID(),
  name = 'Cancellation browser ' + Date.now();
const fixture = (
  await pool.query(
    `INSERT INTO inventory.items(id,name,category_id,branch_id) SELECT $1,$2,category_id,branch_id FROM inventory.items WHERE branch_id='00000000-0000-4000-b111-000000000001' LIMIT 1 RETURNING category_id,branch_id`,
    [id, name],
  )
).rows[0];
const userId = (await pool.query("SELECT id FROM users WHERE username='testadmin'")).rows[0].id;
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  // Verify reversible cancellation in the rendered mobile workflow, then discard a never-uploaded stable queue ID.
  await page.goto('http://[::1]:5198');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('tab', { name: 'All merchandise', exact: true }).click();
  await page.getByLabel('Find incoming merchandise').fill(name);
  await page.locator('.receiving-identity').filter({ hasText: name }).click();
  await page.getByRole('button', { name: 'Cancel intake', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancel intake', exact: true });
  await cancel.getByRole('button', { name: 'Cancel intake', exact: true }).click();
  await cancel.waitFor({ state: 'hidden' });
  await page.getByText('Cancelled intake · photo and history retained').waitFor();
  assert.equal(await page.getByLabel('Product name', { exact: true }).isDisabled(), true);
  await page.screenshot({ path: '../verification/intake-cancelled-mobile.png' });
  await page.keyboard.press('Escape');
  await page.getByLabel('Receiving task').selectOption('cancelled');
  await page.locator('.receiving-identity').filter({ hasText: name }).click();
  await page.getByRole('button', { name: 'Restore intake', exact: true }).click();
  const restore = page.getByRole('dialog', { name: 'Restore intake', exact: true });
  await restore.getByRole('button', { name: 'Restore intake', exact: true }).click();
  await restore.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.querySelector('input[disabled]'));
  await page.keyboard.press('Escape');
  await page.evaluate(
    async ({ id, userId, fixture }) => {
      const { queuePhotos } = await import('/lib/upload-queue.ts');
      await queuePhotos([
        {
          id,
          userId,
          branchId: fixture.branch_id,
          categoryId: fixture.category_id,
          batchId: crypto.randomUUID(),
          batchTitle: 'Cancelled phone queue',
          file: new File(['bytes'], 'wrong-photo.jpg', { type: 'image/jpeg' }),
          createdAt: Date.now(),
        },
      ]);
    },
    { id: queued, userId, fixture },
  );
  await page.getByRole('button', { name: 'New delivery', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel wrong-photo.jpg', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Cancel intake', exact: true })
    .getByRole('button', { name: 'Cancel intake', exact: true })
    .click();
  await page.getByRole('dialog', { name: 'Cancel intake', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByText('1 saved photos waiting', { exact: true }).count(), 0);
  assert.equal(
    (
      await pool.query(
        'SELECT * FROM inventory.intake_cancellations WHERE item_id=$1 AND restored_at IS NULL',
        [queued],
      )
    ).rowCount,
    1,
  );
  assert.equal((await pool.query('SELECT * FROM inventory.items WHERE id=$1', [queued])).rowCount, 0);
  await fs.writeFile(
    '../verification/intake-cancellation.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Mobile cancellation and read-only retained details',
          'Cancelled task filter',
          'Reviewed restore',
          'Queued photo removed only after server tombstone',
          'No item created for discarded queue',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS reversible intake and durable queue cancellation');
} catch (error) {
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
  await pool.end();
}
