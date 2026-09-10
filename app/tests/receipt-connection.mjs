import assert from 'node:assert/strict';
import { isUncertainReceiptError } from '../lib/receipt-connection.ts';
assert.equal(isUncertainReceiptError(new TypeError('Failed to fetch')), true);
for (const status of [502, 503, 504])
  assert.equal(isUncertainReceiptError(Object.assign(new Error('Gateway'), { status })), true);
for (const status of [400, 401, 403, 409, 422])
  assert.equal(isUncertainReceiptError(Object.assign(new Error('Rejected'), { status })), false);
assert.equal(isUncertainReceiptError(new Error('Required field missing')), false);
console.log('PASS lost receipt acknowledgements require readback; business errors retain their handling');
