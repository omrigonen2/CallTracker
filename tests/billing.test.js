'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || 'ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGU=';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/calltracker_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session';
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

let accountStore;
let ledger;
let providerStore;

function resetStores() {
  accountStore = new Map();
  ledger = [];
  providerStore = new Map();
}

resetStores();

function leanWrap(value) {
  return {
    select: function () { return this; },
    lean: async function () { return value; },
    then: function (resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

stub('../src/models/Account', {
  findById: (id) => leanWrap(accountStore.get(String(id)) || null),
  findOneAndUpdate: (filter, update) => {
    const id = String(filter._id);
    const acc = accountStore.get(id);
    let result = null;
    if (acc) {
      const inc = (update && update.$inc && update.$inc.credits) || 0;
      const minBalance = filter.credits && filter.credits.$gte;
      if (inc < 0 && typeof minBalance === 'number' && acc.credits < minBalance) {
        result = null;
      } else {
        acc.credits = (acc.credits || 0) + inc;
        accountStore.set(id, acc);
        result = { ...acc };
      }
    }
    return leanWrap(result);
  },
});

stub('../src/models/ProviderCredential', {
  findById: (id) => leanWrap(providerStore.get(String(id)) || null),
});

stub('../src/models/LedgerEntry', {
  create: async (doc) => {
    const entry = { _id: 'l' + (ledger.length + 1), ...doc, createdAt: new Date() };
    ledger.push(entry);
    return entry;
  },
});

stub('../src/utils/logger', {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
});

let creditUsdRate = 0.01;
stub('../src/services/systemSettings', {
  get: async () => ({ billing: { creditUsdRate } }),
  invalidate: () => {},
  getCreditUsdRate: async () => creditUsdRate,
});

const billing = require('../src/services/billing');

test('applyMargin: percent and fixed', () => {
  assert.strictEqual(billing.applyMargin(1.0, 'percent', 25), 1.25);
  assert.strictEqual(billing.applyMargin(2.0, 'fixed', 0.5), 2.5);
  assert.strictEqual(billing.applyMargin(0, 'percent', 50), 0);
  assert.strictEqual(billing.applyMargin(-5, 'percent', 10), 0, 'negative usd is clamped to 0');
});

test('usdToCredits: rounds up via system-settings rate', async () => {
  creditUsdRate = 0.01;
  assert.strictEqual(await billing.usdToCredits(1.0), 100, '$1.00 with rate 0.01 -> 100 credits');
  assert.strictEqual(await billing.usdToCredits(0.001), 1, 'fractional always rounds up');
  assert.strictEqual(await billing.usdToCredits(0), 0);
});

test('usdToCredits: honors a different rate from systemSettings', async () => {
  creditUsdRate = 0.005;
  try {
    assert.strictEqual(await billing.usdToCredits(1.0), 200, '$1.00 with rate 0.005 -> 200 credits');
    assert.strictEqual(await billing.usdToCredits(0.5), 100);
  } finally {
    creditUsdRate = 0.01;
  }
});

test('computeCredits: uses provider default margin (percent)', async () => {
  resetStores();
  providerStore.set('p1', {
    _id: 'p1',
    margins: {
      numberPurchase: { mode: 'percent', value: 50 },
      numberMonthly: { mode: 'percent', value: 0 },
      callPerMinute: { mode: 'percent', value: 100 },
    },
  });
  const r = await billing.computeCredits({
    providerCredentialId: 'p1',
    accountId: null,
    kind: 'numberPurchase',
    providerCostUsd: 1.0,
  });
  assert.strictEqual(r.marginMode, 'percent');
  assert.strictEqual(r.marginValue, 50);
  assert.strictEqual(r.finalUsd, 1.5);
  assert.strictEqual(r.credits, 150);
});

test('computeCredits: account override (fixed) replaces provider default', async () => {
  resetStores();
  providerStore.set('p1', {
    _id: 'p1',
    margins: { numberPurchase: { mode: 'percent', value: 25 } },
  });
  accountStore.set('a1', {
    _id: 'a1',
    credits: 0,
    providers: {
      marginOverride: {
        numberPurchase: { enabled: true, mode: 'fixed', value: 0.10 },
      },
    },
  });
  const r = await billing.computeCredits({
    providerCredentialId: 'p1',
    accountId: 'a1',
    kind: 'numberPurchase',
    providerCostUsd: 1.0,
  });
  assert.strictEqual(r.marginMode, 'fixed');
  assert.strictEqual(r.marginValue, 0.10);
  assert.strictEqual(r.finalUsd, 1.10);
  assert.strictEqual(r.credits, 110);
});

test('computeCredits: account override disabled falls back to provider default', async () => {
  resetStores();
  providerStore.set('p1', {
    _id: 'p1',
    margins: { callPerMinute: { mode: 'percent', value: 30 } },
  });
  accountStore.set('a1', {
    _id: 'a1',
    credits: 0,
    providers: {
      marginOverride: {
        callPerMinute: { enabled: false, mode: 'fixed', value: 999 },
      },
    },
  });
  const r = await billing.computeCredits({
    providerCredentialId: 'p1',
    accountId: 'a1',
    kind: 'callPerMinute',
    providerCostUsd: 0.50,
  });
  assert.strictEqual(r.marginMode, 'percent');
  assert.strictEqual(r.marginValue, 30);
  assert.strictEqual(r.finalUsd, 0.65);
  assert.strictEqual(r.credits, 65);
});

test('computeCredits: throws on unknown kind', async () => {
  resetStores();
  await assert.rejects(
    billing.computeCredits({
      providerCredentialId: null,
      accountId: null,
      kind: 'bogus',
      providerCostUsd: 1,
    }),
    /unknown margin kind/,
  );
});

test('debit: succeeds when balance is sufficient and writes a ledger entry', async () => {
  resetStores();
  accountStore.set('a1', { _id: 'a1', credits: 500 });

  const result = await billing.debit('a1', 120, {
    kind: 'number_purchase',
    ref: { phoneNumberId: 'pn1' },
    metadata: { country: 'US' },
    createdBy: 'u1',
  });

  assert.strictEqual(result.balance, 380);
  assert.strictEqual(result.credits, 120);
  assert.strictEqual(ledger.length, 1);
  assert.strictEqual(ledger[0].kind, 'number_purchase');
  assert.strictEqual(ledger[0].credits, -120);
  assert.strictEqual(ledger[0].balanceAfter, 380);
  assert.strictEqual(ledger[0].ref.phoneNumberId, 'pn1');
  assert.strictEqual(ledger[0].metadata.country, 'US');
  assert.strictEqual(ledger[0].createdBy, 'u1');
});

test('debit: throws InsufficientCreditsError without writing a ledger entry', async () => {
  resetStores();
  accountStore.set('a1', { _id: 'a1', credits: 50 });

  await assert.rejects(
    billing.debit('a1', 100, { kind: 'call_charge' }),
    (err) => err.code === 'INSUFFICIENT_CREDITS' && err.needed === 100 && err.balance === 50,
  );
  assert.strictEqual(ledger.length, 0);
  assert.strictEqual(accountStore.get('a1').credits, 50, 'balance untouched on failed debit');
});

test('credit: increments balance and appends ledger entry', async () => {
  resetStores();
  accountStore.set('a1', { _id: 'a1', credits: 0 });

  const result = await billing.credit('a1', 1000, { kind: 'topup', metadata: { note: 'manual' } });

  assert.strictEqual(result.balance, 1000);
  assert.strictEqual(result.credits, 1000);
  assert.strictEqual(ledger.length, 1);
  assert.strictEqual(ledger[0].credits, 1000);
  assert.strictEqual(ledger[0].kind, 'topup');
  assert.strictEqual(ledger[0].balanceAfter, 1000);
});

test('debit: rounds fractional amounts up', async () => {
  resetStores();
  accountStore.set('a1', { _id: 'a1', credits: 100 });
  const result = await billing.debit('a1', 12.1, { kind: 'call_charge' });
  assert.strictEqual(result.credits, 13, '12.1 rounded up to 13');
  assert.strictEqual(result.balance, 87);
});

test('noteZero: writes a 0-credit ledger entry without changing balance', async () => {
  resetStores();
  accountStore.set('a1', { _id: 'a1', credits: 25 });

  const entry = await billing.noteZero('a1', {
    kind: 'adjustment',
    ref: { callId: 'c1' },
    metadata: { note: 'insufficient at call time' },
  });

  assert.ok(entry, 'noteZero returns the entry');
  assert.strictEqual(ledger.length, 1);
  assert.strictEqual(ledger[0].credits, 0);
  assert.strictEqual(ledger[0].balanceAfter, 25);
  assert.strictEqual(accountStore.get('a1').credits, 25);
});

test('getBalance: returns 0 for missing account', async () => {
  resetStores();
  const bal = await billing.getBalance('does-not-exist');
  assert.strictEqual(bal, 0);
});
