import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const configuration = JSON.parse(
  (
    await fs.readFile(new URL('../../.test-data/railway-staging-private.json', import.meta.url), 'utf8')
  ).replace(/^\uFEFF/, ''),
);
assert.equal(configuration.database.RAILWAY_PROJECT_ID, '9ce0cab6-9ab1-4da3-854b-afcf4cfa914b');
const api = 'https://pos-api-production-07c3.up.railway.app/api';
const observations = [];

/** Log in once per probe; preserve only status and rate counters, never credentials or tokens. */
async function loginWithHeaders(headers = {}) {
  const response = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(configuration.account),
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, 200, `Login returned ${response.status}`);
  const remainingHeader = response.headers.get('ratelimit-remaining');
  assert.notEqual(remainingHeader, null);
  const remaining = Number(remainingHeader);
  assert(Number.isInteger(remaining) && remaining >= 0);
  observations.push({ status: response.status, remaining });
  const body = await response.json();
  assert(body.token);
  return { token: body.token, remaining };
}

const first = await loginWithHeaders();
assert(first.remaining >= 4, 'Stop before consuming the remaining staging login allowance');
for (let read = 0; read < 25; read += 1) {
  const response = await fetch(`${api}/auth/me`, {
    headers: { Authorization: `Bearer ${first.token}` },
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('ratelimit-remaining'), null);
  // Consume the small response so repeated checks can reuse the HTTPS connection.
  assert.equal((await response.json()).success, true);
}
const spoofed = await loginWithHeaders({
  'X-Real-IP': '192.0.2.123',
  'X-Forwarded-For': '192.0.2.124, 192.0.2.125',
  Forwarded: 'for=192.0.2.126',
  'CF-Connecting-IP': '192.0.2.127',
});
assert.equal(spoofed.remaining, first.remaining - 1);
const rotated = await loginWithHeaders({
  'X-Real-IP': '203.0.113.123',
  'X-Forwarded-For': '203.0.113.124',
});
assert.equal(rotated.remaining, spoofed.remaining - 1);
const result = {
  checked_at: new Date().toISOString(),
  project_id: configuration.database.RAILWAY_PROJECT_ID,
  passed: true,
  observations,
  session_reads_without_spending_login_allowance: 25,
  caller_supplied_forwarding_headers_cannot_split_bucket: true,
  limitations:
    'One actual network client; independent clients and IPv6 grouping tested through the real local Express app. No live allowance exhaustion or stock/AI writes.',
};
await fs.writeFile(
  new URL('../../verification/railway/auth-proxy.json', import.meta.url),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result, null, 2));
