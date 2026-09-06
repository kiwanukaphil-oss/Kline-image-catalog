import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
const results = [];
/** Scan rendered workflows with axe and retain concrete nodes for any accessibility failures. */
async function scan(name) {
  await page.waitForTimeout(350);
  const result = await page.evaluate(
    async () =>
      await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      }),
  );
  results.push({
    name,
    violations: result.violations.map((row) => ({
      id: row.id,
      impact: row.impact,
      help: row.help,
      nodes: row.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
    })),
    incomplete: result.incomplete.map((row) => row.id),
  });
  console.log(name, JSON.stringify(results.at(-1).violations));
}
try {
  await page.goto('http://[::1]:5198');
  await page.addScriptTag({
    path: path.join(os.tmpdir(), 'kline-accessibility-tools/node_modules/axe-core/axe.min.js'),
  });
  await scan('login');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('testpass123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Receiving', exact: true }).waitFor();
  await scan('receiving-light');
  await page.getByRole('button', { name: 'Pricing', exact: true }).click();
  await page.getByLabel('Shared price').waitFor();
  await scan('pricing-light');
  await page.getByRole('button', { name: 'Stock', exact: true }).click();
  await page.locator('.stock-card').first().waitFor();
  await scan('stock-light');
  await page.getByRole('button', { name: 'Use dark appearance', exact: true }).click();
  await scan('stock-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.stock-card').first().click();
  await page.getByRole('dialog').waitFor();
  await scan('stock-detail-mobile-dark');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Receiving', exact: true }).click();
  await page.getByRole('tab', { name: 'All merchandise', exact: true }).click();
  await page.locator('.receiving-identity').first().click();
  await page.getByLabel('Product name', { exact: true }).waitFor();
  await scan('draft-mobile-dark');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
  await scan('settings-mobile-dark');
  await fs.writeFile(
    '../verification/accessibility.json',
    JSON.stringify(
      {
        passed: results.every((row) => !row.violations.length),
        engine: 'axe-core',
        results,
        limitations:
          'Automated checks supplement keyboard and visual review; physical devices and staff acceptance remain separate.',
      },
      null,
      2,
    ),
  );
  if (results.some((row) => row.violations.length)) process.exitCode = 1;
} finally {
  await browser.close();
}
