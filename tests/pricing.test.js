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
    id: fullPath, filename: fullPath, loaded: true, exports: exportsObj,
  };
}

const calls = { twilioMonthly: 0, telnyxMonthly: 0, twilioVoice: 0 };

stub('../src/services/twilioPricing', {
  getNumberMonthlyPriceUsd: async (args) => { calls.twilioMonthly += 1; return 1.15; },
  getVoicePrice: async (_args) => { calls.twilioVoice += 1; return { e164: '+15551234567', country: 'US', inboundCallPriceUsd: 0.0085 }; },
});

stub('../src/services/telnyxPricing', {
  getNumberMonthlyPriceUsd: async (_args) => { calls.telnyxMonthly += 1; return 1.0; },
});

const pricing = require('../src/services/pricing');

test('getNumberMonthlyPriceUsd dispatches to twilioPricing for provider=twilio', async () => {
  calls.twilioMonthly = 0; calls.telnyxMonthly = 0;
  const v = await pricing.getNumberMonthlyPriceUsd({
    provider: 'twilio', credentialId: 'p1', countryCode: 'US', numberType: 'local',
  });
  assert.strictEqual(v, 1.15);
  assert.strictEqual(calls.twilioMonthly, 1);
  assert.strictEqual(calls.telnyxMonthly, 0);
});

test('getNumberMonthlyPriceUsd dispatches to telnyxPricing for provider=telnyx', async () => {
  calls.twilioMonthly = 0; calls.telnyxMonthly = 0;
  const v = await pricing.getNumberMonthlyPriceUsd({
    provider: 'telnyx', credentialId: 'p2', countryCode: 'US', numberType: 'local',
    phoneNumber: '+15551234567',
  });
  assert.strictEqual(v, 1.0);
  assert.strictEqual(calls.telnyxMonthly, 1);
  assert.strictEqual(calls.twilioMonthly, 0);
});

test('getNumberMonthlyPriceUsd throws on unknown provider', async () => {
  await assert.rejects(
    pricing.getNumberMonthlyPriceUsd({ provider: 'bogus', countryCode: 'US' }),
    /unknown provider/i
  );
});

test('getVoicePrice for twilio queries the live pricing API', async () => {
  calls.twilioVoice = 0;
  const r = await pricing.getVoicePrice({
    phoneNumber: { provider: 'twilio', providerCredentialId: 'p1', phoneNumber: '+15551234567' },
  });
  assert.strictEqual(r.perMinuteUsd, 0.0085);
  assert.strictEqual(r.rateRef, 'twilio:US');
  assert.strictEqual(calls.twilioVoice, 1);
});

test('getVoicePrice for telnyx reads inboundPricePerMinUsd from the doc', async () => {
  const r = await pricing.getVoicePrice({
    phoneNumber: { provider: 'telnyx', phoneNumber: '+15555555555', inboundPricePerMinUsd: 0.007 },
  });
  assert.deepStrictEqual(r, { perMinuteUsd: 0.007, rateRef: 'telnyx:stored' });
});

test('getVoicePrice for telnyx throws clearly when the rate is missing', async () => {
  await assert.rejects(
    pricing.getVoicePrice({
      phoneNumber: { provider: 'telnyx', phoneNumber: '+15555555555', inboundPricePerMinUsd: null },
    }),
    /missing stored inboundPricePerMinUsd/
  );
});

test('getVoicePrice throws on unknown provider', async () => {
  await assert.rejects(
    pricing.getVoicePrice({ phoneNumber: { provider: 'bogus', phoneNumber: '+1' } }),
    /unknown provider/i
  );
});
