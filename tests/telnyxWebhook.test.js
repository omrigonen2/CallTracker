'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || 'ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGU=';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/calltracker_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const telnyx = require('../src/services/providers/telnyx');

function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  // Extract raw 32-byte public key from SPKI export.
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const raw = spki.subarray(spki.length - 32);
  return { publicKeyB64: raw.toString('base64'), privateKey };
}

function sign(privateKey, ts, rawBody) {
  const message = Buffer.concat([
    Buffer.from(String(ts), 'utf8'),
    Buffer.from('|', 'utf8'),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8'),
  ]);
  return crypto.sign(null, message, privateKey).toString('base64');
}

test('verifyWebhookSignature accepts a valid signature', () => {
  const { publicKeyB64, privateKey } = makeKeypair();
  const ts = Math.floor(Date.now() / 1000);
  const body = 'CallSid=abc&CallStatus=completed&CallDuration=42';
  const sig = sign(privateKey, ts, body);

  const ok = telnyx.verifyWebhookSignature({
    rawBody: Buffer.from(body),
    signatureB64: sig,
    timestamp: String(ts),
    publicKeyB64,
  });
  assert.strictEqual(ok, true);
});

test('verifyWebhookSignature rejects a tampered body', () => {
  const { publicKeyB64, privateKey } = makeKeypair();
  const ts = Math.floor(Date.now() / 1000);
  const body = 'CallSid=abc&CallStatus=completed&CallDuration=42';
  const sig = sign(privateKey, ts, body);

  const ok = telnyx.verifyWebhookSignature({
    rawBody: Buffer.from(body + '&Tampered=1'),
    signatureB64: sig,
    timestamp: String(ts),
    publicKeyB64,
  });
  assert.strictEqual(ok, false);
});

test('verifyWebhookSignature rejects a stale timestamp', () => {
  const { publicKeyB64, privateKey } = makeKeypair();
  const staleTs = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
  const body = 'CallSid=abc';
  const sig = sign(privateKey, staleTs, body);

  const ok = telnyx.verifyWebhookSignature({
    rawBody: Buffer.from(body),
    signatureB64: sig,
    timestamp: String(staleTs),
    publicKeyB64,
    toleranceSec: 300,
  });
  assert.strictEqual(ok, false);
});

test('verifyWebhookSignature rejects when public key is wrong', () => {
  const { privateKey } = makeKeypair();
  const otherKeypair = makeKeypair();
  const ts = Math.floor(Date.now() / 1000);
  const body = 'CallSid=abc';
  const sig = sign(privateKey, ts, body);

  const ok = telnyx.verifyWebhookSignature({
    rawBody: Buffer.from(body),
    signatureB64: sig,
    timestamp: String(ts),
    publicKeyB64: otherKeypair.publicKeyB64,
  });
  assert.strictEqual(ok, false);
});

test('verifyWebhookSignature rejects on missing inputs', () => {
  assert.strictEqual(telnyx.verifyWebhookSignature({}), false);
  assert.strictEqual(telnyx.verifyWebhookSignature({
    rawBody: Buffer.from('x'), signatureB64: 'sig', timestamp: 'NaN', publicKeyB64: 'k',
  }), false);
});
