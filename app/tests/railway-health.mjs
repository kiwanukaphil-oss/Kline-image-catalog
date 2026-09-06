import fs from 'node:fs/promises';

const catalogOrigin = 'https://catalog-web-production-2d56.up.railway.app';
const posOrigin = 'https://pos-web-production-fee4.up.railway.app';
const apiOrigin = 'https://pos-api-production-07c3.up.railway.app';
const evidencePath = new URL('../../verification/railway/health.json', import.meta.url);

/** Record bounded, read-only probes without credentials or response bodies in evidence. */
async function checkEndpoint(name, path, validate, options = {}) {
  const started = performance.now();
  let status = null;
  try {
    const response = await fetch(path, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    status = response.status;
    const passed = await validate(response);
    await response.body?.cancel().catch(() => {});
    return { name, passed, status, elapsed_ms: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      name,
      passed: false,
      status,
      elapsed_ms: Math.round(performance.now() - started),
      error: error.name === 'TimeoutError' ? 'Timed out after 15 seconds' : 'Request or validation failed',
    };
  }
}

async function hasHealthyJson(response) {
  return response.status === 200 && (await response.json()).status === 'OK';
}

async function hasHtmlDocument(response) {
  return (
    response.status === 200 &&
    response.headers.get('content-type')?.includes('text/html') &&
    /<html[\s>]/i.test(await response.text())
  );
}

function allowsOrigin(origin) {
  return (response) =>
    response.status >= 200 &&
    response.status < 300 &&
    response.headers.get('access-control-allow-origin') === origin &&
    response.headers.get('access-control-allow-methods')?.split(/,\s*/).includes('GET');
}

function preflightOptions(origin) {
  return { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } };
}

const checks = await Promise.all([
  checkEndpoint('Catalog HTML', catalogOrigin, hasHtmlDocument),
  checkEndpoint('POS HTML', posOrigin, hasHtmlDocument),
  checkEndpoint('API process', `${apiOrigin}/api/health`, hasHealthyJson),
  checkEndpoint('Database connectivity', `${apiOrigin}/api/db-health`, hasHealthyJson),
  checkEndpoint(
    'Anonymous workspace denied',
    `${apiOrigin}/api/catalog-workspace/stock`,
    (response) => response.status === 401,
  ),
  ...[catalogOrigin, posOrigin].map((origin) =>
    checkEndpoint(
      `CORS permits ${origin}`,
      `${apiOrigin}/api/catalog-workspace/stock`,
      allowsOrigin(origin),
      preflightOptions(origin),
    ),
  ),
  checkEndpoint(
    'CORS denies foreign origin',
    `${apiOrigin}/api/catalog-workspace/stock`,
    (response) =>
      [200, 204, 400, 403, 500].includes(response.status) &&
      !response.headers.has('access-control-allow-origin'),
    preflightOptions('https://untrusted.invalid'),
  ),
]);

const result = {
  checked_at: new Date().toISOString(),
  project_id: '9ce0cab6-9ab1-4da3-854b-afcf4cfa914b',
  scope: 'Isolated Railway staging; unauthenticated, read-only checks',
  passed: checks.every((check) => check.passed === true),
  checks,
  limitations:
    'A point-in-time probe, not scheduled monitoring or a browser, login, AI, photo or commerce test.',
};
await fs.mkdir(new URL('.', evidencePath), { recursive: true });
await fs.writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.passed ? 0 : 1;
