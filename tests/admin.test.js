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

function chain(value) {
  const obj = {
    sort: function () { return this; },
    limit: function () { return this; },
    skip: function () { return this; },
    populate: function () { return this; },
    select: function () { return this; },
    lean: async function () { return value; },
    then: function (resolve) { return Promise.resolve(value).then(resolve); },
  };
  return obj;
}

const accountFixture = {
  _id: 'a1',
  name: 'Acme',
  slug: 'acme',
  status: 'active',
  defaultLocale: 'en',
  timezone: 'UTC',
  plan: 'free',
  limits: { numbers: 100, users: 25, callsPerMonth: 100000 },
  createdAt: new Date(),
};

stub('../src/models/Account', {
  countDocuments: async () => 3,
  find: () => chain([accountFixture]),
  findById: (id) => {
    const value = id === 'a1' ? accountFixture : null;
    return {
      lean: async () => value,
      then: function (resolve) { return Promise.resolve(value).then(resolve); },
    };
  },
});

stub('../src/models/User', {
  countDocuments: async () => 7,
  find: () => chain([
    { _id: 'u1', email: 'admin@example.com', name: 'Admin', isSuperAdmin: true, locale: 'en', createdAt: new Date() },
    { _id: 'u2', email: 'user@example.com', name: 'User', isSuperAdmin: false, locale: 'en', createdAt: new Date() },
  ]),
  findById: async () => null,
});

stub('../src/models/PhoneNumber', {
  countDocuments: async () => 2,
  find: () => chain([]),
});

stub('../src/models/Call', {
  countDocuments: async () => 0,
});

stub('../src/models/Membership', {
  find: () => chain([]),
});

stub('../src/models/AuditLog', {
  find: () => chain([]),
});

stub('../src/models/ProviderCredential', {
  findById: async () => null,
});

stub('../src/services/credentialStore', {
  listSafe: async () => [
    { _id: 'p1', provider: 'twilio', label: 'Default Twilio', isDefault: true, rotatedAt: new Date(), createdAt: new Date() },
  ],
});

stub('../src/services/audit', {
  record: async () => {},
  fromReq: () => ({}),
});

const cookieIssued = { value: null };
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireSuperAdmin: (req, res, next) => {
      if (!req.user || !req.user.isSuperAdmin) return res.status(403).end();
      next();
    },
    loadSession: (req, _res, next) => next(),
    loadAccount: (req, _res, next) => next(),
    requireAuth: (req, _res, next) => next(),
    requireAccount: (req, _res, next) => next(),
    withTenantContext: (req, _res, next) => next(),
    signSession: ({ userId, accountId, impersonate }) => `tok:${userId}:${accountId || ''}:${impersonate ? 1 : 0}`,
    setSessionCookie: (res, token) => {
      cookieIssued.value = token;
      res.cookie('ct_session', token, { httpOnly: true, path: '/' });
    },
  },
};

const express = require('express');
const adminRouter = require('../src/routes/admin');

function makeApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'src', 'views'));
  app.use((req, res, next) => {
    req.user = { _id: 'super1', isSuperAdmin: true, name: 'Super Admin', email: 'sa@example.com' };
    res.locals.user = req.user;
    res.locals.account = null;
    res.locals.accounts = [];
    res.locals.hasAccount = false;
    res.locals.isSuperAdmin = true;
    res.locals.permissions = new Set();
    res.locals.can = () => true;
    res.locals.locale = 'en';
    res.locals.dir = 'ltr';
    res.locals.locales = ['en', 'he'];
    res.locals.timezones = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Jerusalem'];
    res.locals.countries = [
      { iso: 'US', name: 'United States', dial: '1' },
      { iso: 'IL', name: 'Israel', dial: '972' },
    ];
    res.locals.splitE164 = () => ({ dial: '', national: '' });
    res.locals.currentUrl = req.originalUrl;
    res.locals.flash = [];
    res.locals.t = (k) => String(k);
    next();
  });
  app.use('/admin', adminRouter);

  const auth = require('../src/middleware/auth');
  app.post('/exit-impersonation', async (req, res, next) => {
    try {
      if (req.user && req.user.isSuperAdmin) {
        const token = auth.signSession({ userId: req.user._id, accountId: null, impersonate: false });
        auth.setSessionCookie(res, token);
      }
      res.redirect('/admin');
    } catch (e) { next(e); }
  });

  app.use((err, _req, res, _next) => {
    res.status(500).end(err && err.stack ? err.stack : String(err));
  });
  return app;
}

function getStatus(app, url) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      http
        .get(`http://127.0.0.1:${port}${url}`, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, body, headers: res.headers });
          });
        })
        .on('error', (e) => {
          server.close();
          resolve({ status: 0, body: e.message });
        });
    });
  });
}

function postRequest(app, url) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const req = http.request(
        { method: 'POST', host: '127.0.0.1', port, path: url, headers: { 'content-length': 0 } },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, body, headers: res.headers });
          });
        },
      );
      req.on('error', (e) => {
        server.close();
        resolve({ status: 0, body: e.message, headers: {} });
      });
      req.end();
    });
  });
}

test('admin smoke: every admin GET returns 200 for super-admin without membership', async () => {
  const app = makeApp();
  const urls = [
    '/admin',
    '/admin/accounts',
    '/admin/accounts/new',
    '/admin/accounts/a1',
    '/admin/accounts/a1/edit',
    '/admin/providers',
    '/admin/providers/new',
    '/admin/audit',
    '/admin/users',
  ];
  for (const u of urls) {
    const res = await getStatus(app, u);
    assert.strictEqual(
      res.status,
      200,
      `GET ${u} returned ${res.status}\n${(res.body || '').slice(0, 600)}`,
    );
  }
});

test('account-edit renders a timezone <select> populated with IANA zones', async () => {
  const app = makeApp();
  const res = await getStatus(app, '/admin/accounts/a1/edit');
  assert.strictEqual(res.status, 200);
  assert.match(res.body, /<select[^>]+id="timezone"/, 'timezone field should be a <select>');
  assert.match(res.body, /<option[^>]+value="UTC"/, 'UTC option should be present');
  assert.match(res.body, /<option[^>]+value="Asia\/Jerusalem"/, 'Asia/Jerusalem option should be present');
  assert.doesNotMatch(res.body, /<input[^>]+id="timezone"/, 'timezone <input> should be removed');
});

test('account-edit renders a default-country <select> and a plan <select>', async () => {
  const app = makeApp();
  const res = await getStatus(app, '/admin/accounts/a1/edit');
  assert.strictEqual(res.status, 200);
  assert.match(res.body, /<select[^>]+id="defaultCountry"/, 'defaultCountry must be a <select>');
  assert.match(res.body, /<option[^>]+value="US"/, 'US country option must be present');
  assert.match(res.body, /<option[^>]+value="IL"/, 'IL country option must be present');
  assert.match(res.body, /<select[^>]+id="plan"/, 'plan must be a <select>');
  assert.match(res.body, /<option[^>]+value="enterprise"/, 'enterprise plan option must be present');
  assert.doesNotMatch(res.body, /<input[^>]+id="plan"/, 'plan <input> should be removed');
});

test('sidebar hides Workspace links for super-admin without an active membership', async () => {
  const app = makeApp();
  const res = await getStatus(app, '/admin/accounts/a1');
  assert.strictEqual(res.status, 200);
  assert.doesNotMatch(res.body, /href="\/campaigns"/, 'should not render Workspace > Campaigns link');
  assert.doesNotMatch(res.body, /href="\/numbers"/, 'should not render Workspace > Numbers link');
  assert.doesNotMatch(res.body, /href="\/calls"/, 'should not render Workspace > Calls link');
  assert.match(res.body, /href="\/admin\/accounts"/, 'should still render System Admin > Accounts link');
});

test('admin/accounts list does not leak system accounts into the sidebar account-switcher', async () => {
  const app = makeApp();
  const res = await getStatus(app, '/admin/accounts');
  assert.strictEqual(res.status, 200);
  assert.doesNotMatch(
    res.body,
    /<form[^>]*class="acct-switcher"/,
    'sidebar account-switcher must not render when user has no memberships',
  );
});

test('POST /admin/accounts/:id/use issues an impersonation cookie and redirects to /', async () => {
  cookieIssued.value = null;
  const app = makeApp();
  const res = await postRequest(app, '/admin/accounts/a1/use');
  assert.strictEqual(res.status, 302, `expected 302, got ${res.status}\n${res.body.slice(0, 400)}`);
  assert.strictEqual(res.headers.location, '/');
  const setCookie = res.headers['set-cookie'] || [];
  assert.ok(
    setCookie.some((c) => /^ct_session=/.test(c)),
    `expected ct_session cookie, got ${JSON.stringify(setCookie)}`,
  );
  assert.match(cookieIssued.value || '', /:1$/, 'token should carry impersonate=1');
});

test('POST /admin/accounts/:id/use returns 404 for a missing account', async () => {
  const app = makeApp();
  const res = await postRequest(app, '/admin/accounts/missing/use');
  assert.strictEqual(res.status, 404);
});

test('POST /exit-impersonation clears impersonation and redirects to /admin', async () => {
  cookieIssued.value = null;
  const app = makeApp();
  const res = await postRequest(app, '/exit-impersonation');
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.location, '/admin');
  assert.match(cookieIssued.value || '', /:0$/, 'token should carry impersonate=0');
});

test('topbar renders the impersonation banner when impersonating is true', async () => {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'src', 'views'));
  app.get('/test-banner', (req, res) => {
    res.locals.user = { _id: 'su', name: 'Super', email: 'su@x.com' };
    res.locals.account = { _id: 'a1', name: 'Acme', slug: 'acme' };
    res.locals.accounts = [];
    res.locals.hasAccount = true;
    res.locals.isSuperAdmin = true;
    res.locals.impersonating = true;
    res.locals.permissions = new Set();
    res.locals.can = () => true;
    res.locals.locale = 'en';
    res.locals.dir = 'ltr';
    res.locals.locales = ['en', 'he'];
    res.locals.timezones = ['UTC'];
    res.locals.countries = [{ iso: 'US', name: 'United States', dial: '1' }];
    res.locals.splitE164 = () => ({ dial: '', national: '' });
    res.locals.currentUrl = '/test-banner';
    res.locals.flash = [];
    res.locals.t = (k) => String(k);
    res.render('partials/topbar');
  });
  const res = await getStatus(app, '/test-banner');
  assert.strictEqual(res.status, 200);
  assert.match(res.body, /class="impersonation-bar"/);
  assert.match(res.body, /action="\/exit-impersonation"/);
});
