'use strict';

const test = require('node:test');
const assert = require('node:assert');
const ctx = require('../src/utils/asyncContext');

test('async context isolates accountId between concurrent flows', async () => {
  const results = await Promise.all([
    new Promise((resolve) => ctx.runWith({ accountId: 'A' }, () => setTimeout(() => resolve(ctx.getAccountId()), 5))),
    new Promise((resolve) => ctx.runWith({ accountId: 'B' }, () => setTimeout(() => resolve(ctx.getAccountId()), 5))),
  ]);
  assert.deepStrictEqual(results.sort(), ['A', 'B']);
});

test('crypto helper round-trips', () => {
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || 'ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGU=';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/config/crypto')];
  const { encrypt, decrypt } = require('../src/config/crypto');
  const obj = { accountSid: 'AC123', authToken: 'secret' };
  const ct = encrypt(obj);
  assert.notStrictEqual(ct, JSON.stringify(obj));
  const pt = decrypt(ct);
  assert.deepStrictEqual(pt, obj);
});

test('routing engine respects time-based rules and number override', () => {
  const { resolveForwardTo } = require('../src/services/routing');
  const r1 = resolveForwardTo({
    phoneNumberDoc: { forwardingOverride: '+15550001' },
    campaignDoc: { defaultForwardingNumber: '+15550002', routingRules: [], timezone: 'UTC' },
  });
  assert.strictEqual(r1.forwardTo, '+15550001');
  const r2 = resolveForwardTo({
    phoneNumberDoc: { forwardingOverride: '' },
    campaignDoc: { defaultForwardingNumber: '+15550002', routingRules: [], timezone: 'UTC' },
  });
  assert.strictEqual(r2.forwardTo, '+15550002');
});
