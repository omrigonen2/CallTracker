'use strict';

const twilio = require('twilio');
const credentialStore = require('../credentialStore');

async function client(credentialId = null) {
  const c = await credentialStore.get('twilio', credentialId);
  if (!c.accountSid || !c.authToken) throw new Error('Twilio credentials missing accountSid/authToken');
  return {
    client: twilio(c.accountSid, c.authToken, { timeout: 15000 }),
    creds: c,
  };
}

async function listAvailableNumbers({ countryCode = 'US', areaCode, contains, numberType = 'local', limit = 20 }) {
  const { client: tw } = await client();
  const TYPE_BUCKETS = { local: 'local', tollFree: 'tollFree', mobile: 'mobile' };
  const bucket = TYPE_BUCKETS[numberType] || 'local';
  const opts = { limit: Math.min(parseInt(limit, 10) || 20, 50) };
  if (areaCode) opts.areaCode = String(areaCode).replace(/[^0-9]/g, '') || undefined;
  if (contains) opts.contains = String(contains).replace(/[^0-9]/g, '') || undefined;
  const numbers = await tw.availablePhoneNumbers(countryCode)[bucket].list(opts);
  return numbers.map((n) => ({ phoneNumber: n.phoneNumber, friendlyName: n.friendlyName, locality: n.locality, region: n.region }));
}

async function buyNumber({ phoneNumber, voiceUrl, statusCallback, voiceMethod = 'POST' }) {
  const { client: tw, creds } = await client();
  const purchased = await tw.incomingPhoneNumbers.create({ phoneNumber, voiceUrl, statusCallback, voiceMethod });
  return { credentialId: creds.id, providerNumberId: purchased.sid, phoneNumber: purchased.phoneNumber };
}

async function releaseNumber({ providerNumberId, credentialId = null }) {
  const { client: tw } = await client(credentialId);
  await tw.incomingPhoneNumbers(providerNumberId).remove();
}

async function updateNumberWebhooks({ providerNumberId, voiceUrl, statusCallback, credentialId = null }) {
  const { client: tw } = await client(credentialId);
  await tw.incomingPhoneNumbers(providerNumberId).update({ voiceUrl, statusCallback });
}

async function fetchRecording({ recordingSid, credentialId = null }) {
  const { client: tw } = await client(credentialId);
  return tw.recordings(recordingSid).fetch();
}

function validateWebhookSignature({ signature, url, params, authToken }) {
  return twilio.validateRequest(authToken, signature, url, params);
}

async function getAuthTokenForRequest(credentialId = null) {
  const c = await credentialStore.get('twilio', credentialId);
  return c.authToken;
}

function buildVoiceTwiML({ forwardTo, record, whisperText, locale }) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const r = new VoiceResponse();
  const dial = r.dial({
    record: record ? 'record-from-answer-dual' : undefined,
    answerOnBridge: true,
  });
  if (whisperText) {
    dial.number({ url: undefined }, forwardTo);
  } else {
    dial.number(forwardTo);
  }
  return r.toString();
}

module.exports = {
  name: 'twilio',
  listAvailableNumbers,
  buyNumber,
  releaseNumber,
  updateNumberWebhooks,
  fetchRecording,
  validateWebhookSignature,
  getAuthTokenForRequest,
  buildVoiceTwiML,
};
