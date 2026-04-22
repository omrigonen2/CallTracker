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

let mailCfg = { fromEmail: 'CallTracker <noreply@example.com>', replyTo: '' };
let apiKey = 're_test_key_abcdef';

stub('../src/services/systemSettings', {
  get: async () => ({ mail: mailCfg }),
  invalidate: () => {},
  getMail: async () => mailCfg,
  getResendApiKey: async () => apiKey,
});

stub('../src/utils/logger', {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
});

const captured = { calls: [] };
const ORIG_FETCH = global.fetch;

function makeFetch(responder) {
  return async (url, opts) => {
    captured.calls.push({ url, opts });
    return responder(url, opts);
  };
}

function reset() {
  captured.calls = [];
  mailCfg = { fromEmail: 'CallTracker <noreply@example.com>', replyTo: '' };
  apiKey = 're_test_key_abcdef';
}

const email = require('../src/services/email');

test.afterEach(() => { global.fetch = ORIG_FETCH; });

test('send: posts to Resend with correct URL, headers and JSON payload', async () => {
  reset();
  global.fetch = makeFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'msg_1' }),
    text: async () => '',
  }));

  const result = await email.send({
    to: 'user@example.com',
    subject: 'Hi',
    html: '<p>Hello</p>',
    text: 'Hello',
  });

  assert.strictEqual(result.id, 'msg_1');
  assert.strictEqual(captured.calls.length, 1);
  const { url, opts } = captured.calls[0];
  assert.strictEqual(url, 'https://api.resend.com/emails');
  assert.strictEqual(opts.method, 'POST');
  assert.strictEqual(opts.headers.authorization, 'Bearer re_test_key_abcdef');
  assert.strictEqual(opts.headers['content-type'], 'application/json');

  const body = JSON.parse(opts.body);
  assert.strictEqual(body.from, 'CallTracker <noreply@example.com>');
  assert.deepStrictEqual(body.to, ['user@example.com']);
  assert.strictEqual(body.subject, 'Hi');
  assert.strictEqual(body.html, '<p>Hello</p>');
  assert.strictEqual(body.text, 'Hello');
  assert.strictEqual(body.reply_to, undefined);
  assert.ok(opts.signal, 'AbortSignal attached for timeout');
});

test('send: includes reply_to from settings when not overridden', async () => {
  reset();
  mailCfg = { fromEmail: 'a@b.com', replyTo: 'support@b.com' };
  global.fetch = makeFetch(async () => ({
    ok: true, status: 200, json: async () => ({ id: 'm' }), text: async () => '',
  }));

  await email.send({ to: 'u@x.com', subject: 's', html: 'h' });
  const body = JSON.parse(captured.calls[0].opts.body);
  assert.strictEqual(body.reply_to, 'support@b.com');
});

test('send: per-call from / replyTo overrides settings', async () => {
  reset();
  global.fetch = makeFetch(async () => ({
    ok: true, status: 200, json: async () => ({ id: 'm' }), text: async () => '',
  }));

  await email.send({
    to: 'u@x.com', subject: 's', html: 'h',
    from: 'Override <ov@x.com>',
    replyTo: 'reply@x.com',
  });
  const body = JSON.parse(captured.calls[0].opts.body);
  assert.strictEqual(body.from, 'Override <ov@x.com>');
  assert.strictEqual(body.reply_to, 'reply@x.com');
});

test('send: array `to` is preserved as-is', async () => {
  reset();
  global.fetch = makeFetch(async () => ({
    ok: true, status: 200, json: async () => ({ id: 'm' }), text: async () => '',
  }));

  await email.send({ to: ['a@x.com', 'b@x.com'], subject: 's', html: 'h' });
  const body = JSON.parse(captured.calls[0].opts.body);
  assert.deepStrictEqual(body.to, ['a@x.com', 'b@x.com']);
});

test('send: surfaces 4xx as Error containing status and body', async () => {
  reset();
  global.fetch = makeFetch(async () => ({
    ok: false,
    status: 422,
    json: async () => ({}),
    text: async () => '{"name":"validation_error","message":"bad from"}',
  }));

  await assert.rejects(
    email.send({ to: 'u@x.com', subject: 's', html: 'h' }),
    (err) => /resend 422/.test(err.message) && /bad from/.test(err.message),
  );
});

test('send: dev stub returns when API key missing in non-prod', async () => {
  reset();
  apiKey = null;
  let called = false;
  global.fetch = makeFetch(async () => { called = true; return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; });

  const r = await email.send({ to: 'u@x.com', subject: 's', html: 'h' });
  assert.strictEqual(called, false, 'fetch must NOT be called when unconfigured');
  assert.strictEqual(r.id, 'dev');
  assert.deepStrictEqual(r.accepted, ['u@x.com']);
});

test('send: dev stub returns when fromEmail missing in non-prod', async () => {
  reset();
  mailCfg = { fromEmail: '', replyTo: '' };
  let called = false;
  global.fetch = makeFetch(async () => { called = true; return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; });

  const r = await email.send({ to: 'u@x.com', subject: 's', html: 'h' });
  assert.strictEqual(called, false);
  assert.strictEqual(r.id, 'dev');
});
