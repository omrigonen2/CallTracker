'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || 'ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGU=';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/calltracker_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const http = require('http');

function stub(modulePath, exportsObj) {
  const fullPath = require.resolve(modulePath);
  require.cache[fullPath] = {
    id: fullPath,
    filename: fullPath,
    loaded: true,
    exports: exportsObj,
  };
}

function leanWrap(value) {
  return {
    select: function () { return this; },
    sort: function () { return this; },
    populate: function () { return this; },
    lean: async function () { return value; },
    then: function (resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

const accountFixture = {
  _id: 'a1',
  name: 'Acme',
  defaultCountry: 'US',
  credits: 10000,
};

const primaryCred = { _id: 'p1', provider: 'twilio', label: 'primary', margins: {} };
const fallbackCred = { _id: 'p2', provider: 'twilio', label: 'fallback', margins: {} };

stub('../src/models/Account', {
  findById: () => leanWrap(accountFixture),
});

stub('../src/models/PhoneNumber', {
  find: () => leanWrap([]),
  countDocuments: async () => 0,
  create: async (doc) => ({ ...doc, _id: 'pn-new' }),
  deleteOne: async () => ({}),
});

stub('../src/models/Campaign', {
  find: () => leanWrap([]),
});

stub('../src/models/ProviderCredential', {
  countDocuments: async () => 2,
  findById: (id) => leanWrap(String(id) === 'p1' ? primaryCred : (String(id) === 'p2' ? fallbackCred : null)),
  findOne: () => leanWrap(primaryCred),
});

const releasedNumbers = [];
let primaryShouldFail = false;
let fallbackShouldFail = false;

stub('../src/services/providers', {
  get: (name) => ({
    listAvailableNumbers: async () => [{ phoneNumber: '+15551234567', friendlyName: '+15551234567' }],
    buyNumber: async ({ credentialId, phoneNumber }) => {
      if (String(credentialId) === 'p1' && primaryShouldFail) {
        throw new Error('primary boom');
      }
      if (String(credentialId) === 'p2' && fallbackShouldFail) {
        throw new Error('fallback boom');
      }
      return {
        providerNumberId: 'sid-' + credentialId,
        phoneNumber,
      };
    },
    releaseNumber: async ({ providerNumberId }) => {
      releasedNumbers.push(providerNumberId);
    },
  }),
  list: () => ['twilio'],
});

stub('../src/services/providerSelector', {
  getForAccount: async () => ({ primary: primaryCred, fallback: fallbackCred }),
  NoPrimaryProviderError: class extends Error {},
});

stub('../src/services/twilioPricing', {
  getNumberMonthlyPriceUsd: async () => 1.0,
  listAvailablePrices: async () => null,
  getVoicePrice: async () => 0.013,
});

const debits = [];
const credits = [];
let balance = 10000;
const insufficientBalance = { value: false };

stub('../src/services/billing', {
  MARGIN_KINDS: ['numberPurchase', 'numberMonthly', 'callPerMinute'],
  InsufficientCreditsError: class extends Error {
    constructor() { super('INSUFFICIENT_CREDITS'); this.code = 'INSUFFICIENT_CREDITS'; }
  },
  computeCredits: async ({ kind, providerCostUsd }) => ({
    credits: Math.ceil(providerCostUsd * 100),
    marginMode: 'percent', marginValue: 0,
    finalUsd: providerCostUsd, providerCostUsd,
  }),
  getBalance: async () => balance,
  debit: async (accountId, amount, opts) => {
    if (insufficientBalance.value) {
      const e = new Error('INSUFFICIENT_CREDITS');
      e.code = 'INSUFFICIENT_CREDITS';
      throw e;
    }
    debits.push({ accountId: String(accountId), amount, opts });
    balance -= amount;
    return { balance, credits: amount };
  },
  credit: async (accountId, amount, opts) => {
    credits.push({ accountId: String(accountId), amount, opts });
    balance += amount;
    return { balance, credits: amount };
  },
  noteZero: async () => null,
});

stub('../src/services/audit', {
  record: async () => {},
  fromReq: () => ({}),
});

stub('../src/utils/logger', {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
});

const rbacPath = require.resolve('../src/middleware/rbac');
require.cache[rbacPath] = {
  id: rbacPath, filename: rbacPath, loaded: true,
  exports: { requirePermission: () => (req, _res, next) => next() },
};

const express = require('express');
const numbersRouter = require('../src/routes/numbers');

function makeApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'src', 'views'));
  app.use((req, res, next) => {
    req.user = { _id: 'u1', name: 'User', email: 'u@x.com' };
    req.account = accountFixture;
    res.locals.user = req.user;
    res.locals.account = accountFixture;
    res.locals.accounts = [accountFixture];
    res.locals.hasAccount = true;
    res.locals.isSuperAdmin = false;
    res.locals.permissions = new Set();
    res.locals.can = () => true;
    res.locals.locale = 'en';
    res.locals.dir = 'ltr';
    res.locals.locales = ['en', 'he'];
    res.locals.timezones = ['UTC'];
    res.locals.countries = [{ iso: 'US', name: 'United States', dial: '1' }];
    res.locals.splitE164 = () => ({ dial: '', national: '' });
    res.locals.currentUrl = req.originalUrl;
    res.locals.flash = [];
    res.locals.creditsBalance = balance;
    res.locals.t = (k) => String(k);
    res.flash = () => {};
    next();
  });
  app.use('/numbers', numbersRouter);
  app.use((err, _req, res, _next) => {
    res.status(500).end(err && err.stack ? err.stack : String(err));
  });
  return app;
}

function postForm(app, url, fields) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const body = new URLSearchParams(fields).toString();
      const req = http.request(
        {
          method: 'POST', host: '127.0.0.1', port, path: url,
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) },
        },
        (res) => {
          let chunks = '';
          res.on('data', (c) => (chunks += c));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, body: chunks, headers: res.headers });
          });
        },
      );
      req.on('error', (e) => { server.close(); resolve({ status: 0, body: e.message, headers: {} }); });
      req.write(body); req.end();
    });
  });
}

function reset() {
  primaryShouldFail = false;
  fallbackShouldFail = false;
  releasedNumbers.length = 0;
  debits.length = 0;
  credits.length = 0;
  balance = 10000;
  insufficientBalance.value = false;
}

test('buy: primary succeeds, debits credits and creates PhoneNumber', async () => {
  reset();
  const app = makeApp();
  const res = await postForm(app, '/numbers/buy', { phoneNumber: '+15551234567', countryCode: 'US', numberType: 'local' });
  assert.strictEqual(res.status, 302, `expected 302, got ${res.status}\n${res.body.slice(0, 500)}`);
  assert.strictEqual(debits.length, 1, 'debit called once');
  assert.strictEqual(debits[0].opts.kind, 'number_purchase');
  assert.strictEqual(releasedNumbers.length, 0, 'no rollback');
});

test('buy: primary fails, fallback succeeds and is used', async () => {
  reset();
  primaryShouldFail = true;
  const app = makeApp();
  const res = await postForm(app, '/numbers/buy', { phoneNumber: '+15551234567', countryCode: 'US', numberType: 'local' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(debits.length, 1, 'debit happened on fallback success');
  assert.strictEqual(debits[0].opts.ref.providerCredentialId, 'p2', 'debit references fallback credential');
  assert.strictEqual(releasedNumbers.length, 0);
});

test('buy: insufficient balance short-circuits before purchase', async () => {
  reset();
  insufficientBalance.value = true;
  balance = 0;
  const app = makeApp();
  const res = await postForm(app, '/numbers/buy', { phoneNumber: '+15551234567', countryCode: 'US', numberType: 'local' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(debits.length, 0, 'debit not attempted when balance is below price');
});

test('buy: both providers fail returns flash error redirect', async () => {
  reset();
  primaryShouldFail = true;
  fallbackShouldFail = true;
  const app = makeApp();
  const res = await postForm(app, '/numbers/buy', { phoneNumber: '+15551234567', countryCode: 'US', numberType: 'local' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(debits.length, 0, 'no debit when no purchase succeeded');
});
