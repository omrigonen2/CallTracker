'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || 'ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGU=';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/calltracker_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

function stub(modulePath, exportsObj) {
  const fullPath = require.resolve(modulePath);
  require.cache[fullPath] = {
    id: fullPath,
    filename: fullPath,
    loaded: true,
    exports: exportsObj,
  };
}

let storedDoc = null;
let getOrCreateCalls = 0;

stub('../src/models/SystemSetting', {
  getOrCreate: async () => {
    getOrCreateCalls += 1;
    if (!storedDoc) storedDoc = { key: 'global', billing: { creditUsdRate: 0.01 } };
    return storedDoc;
  },
});

stub('../src/utils/logger', {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
});

let cryptoBehavior = {
  decrypt: (blob) => {
    if (blob === 'BAD') throw new Error('bad blob');
    return JSON.parse(blob);
  },
  encrypt: (obj) => JSON.stringify(obj),
};
stub('../src/config/crypto', {
  decrypt: (b) => cryptoBehavior.decrypt(b),
  encrypt: (o) => cryptoBehavior.encrypt(o),
});

const systemSettings = require('../src/services/systemSettings');

test('get(): caches result so repeated calls hit Mongo only once', async () => {
  systemSettings.invalidate();
  storedDoc = null;
  getOrCreateCalls = 0;

  const a = await systemSettings.get();
  const b = await systemSettings.get();
  const c = await systemSettings.get();

  assert.strictEqual(getOrCreateCalls, 1, 'getOrCreate called once across 3 reads');
  assert.strictEqual(a, b);
  assert.strictEqual(b, c);
});

test('invalidate(): forces a fresh load', async () => {
  systemSettings.invalidate();
  storedDoc = null;
  getOrCreateCalls = 0;

  await systemSettings.get();
  systemSettings.invalidate();
  await systemSettings.get();

  assert.strictEqual(getOrCreateCalls, 2);
});

test('getCreditUsdRate(): returns stored value', async () => {
  systemSettings.invalidate();
  storedDoc = { key: 'global', billing: { creditUsdRate: 0.005 } };

  const rate = await systemSettings.getCreditUsdRate();
  assert.strictEqual(rate, 0.005);
});

test('getCreditUsdRate(): falls back to 0.01 when missing/invalid', async () => {
  systemSettings.invalidate();
  storedDoc = { key: 'global', billing: { creditUsdRate: 0 } };
  let rate = await systemSettings.getCreditUsdRate();
  assert.strictEqual(rate, 0.01, 'zero falls back to default');

  systemSettings.invalidate();
  storedDoc = { key: 'global', billing: {} };
  rate = await systemSettings.getCreditUsdRate();
  assert.strictEqual(rate, 0.01, 'undefined falls back to default');

  systemSettings.invalidate();
  storedDoc = { key: 'global', billing: { creditUsdRate: -1 } };
  rate = await systemSettings.getCreditUsdRate();
  assert.strictEqual(rate, 0.01, 'negative falls back to default');
});

test('getMail(): returns mail subdocument or empty object', async () => {
  systemSettings.invalidate();
  storedDoc = { key: 'global', billing: { creditUsdRate: 0.01 }, mail: { fromEmail: 'a@b.com', replyTo: 'r@b.com' } };
  const m = await systemSettings.getMail();
  assert.strictEqual(m.fromEmail, 'a@b.com');
  assert.strictEqual(m.replyTo, 'r@b.com');

  systemSettings.invalidate();
  storedDoc = { key: 'global', billing: { creditUsdRate: 0.01 } };
  const m2 = await systemSettings.getMail();
  assert.deepStrictEqual(m2, {});
});

test('getResendApiKey(): returns decrypted key when set', async () => {
  systemSettings.invalidate();
  storedDoc = {
    key: 'global',
    billing: { creditUsdRate: 0.01 },
    mail: { apiKeyEncrypted: JSON.stringify({ key: 're_secret_123' }) },
  };
  const k = await systemSettings.getResendApiKey();
  assert.strictEqual(k, 're_secret_123');
});

test('getResendApiKey(): returns null when no encrypted key stored', async () => {
  systemSettings.invalidate();
  storedDoc = { key: 'global', billing: { creditUsdRate: 0.01 }, mail: {} };
  const k = await systemSettings.getResendApiKey();
  assert.strictEqual(k, null);
});

test('getResendApiKey(): returns null when decrypt throws', async () => {
  systemSettings.invalidate();
  storedDoc = {
    key: 'global',
    billing: { creditUsdRate: 0.01 },
    mail: { apiKeyEncrypted: 'BAD' },
  };
  const k = await systemSettings.getResendApiKey();
  assert.strictEqual(k, null);
});

test('getResendApiKey(): returns null when decrypted payload lacks key', async () => {
  systemSettings.invalidate();
  storedDoc = {
    key: 'global',
    billing: { creditUsdRate: 0.01 },
    mail: { apiKeyEncrypted: JSON.stringify({ other: 'x' }) },
  };
  const k = await systemSettings.getResendApiKey();
  assert.strictEqual(k, null);
});

test('get(): returns safe default when getOrCreate throws', async () => {
  systemSettings.invalidate();
  const SystemSetting = require('../src/models/SystemSetting');
  const orig = SystemSetting.getOrCreate;
  SystemSetting.getOrCreate = async () => { throw new Error('mongo down'); };
  try {
    const s = await systemSettings.get();
    assert.ok(s && s.billing);
    assert.strictEqual(s.billing.creditUsdRate, 0.01);
  } finally {
    SystemSetting.getOrCreate = orig;
  }
});
