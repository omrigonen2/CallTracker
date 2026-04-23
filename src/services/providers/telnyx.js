'use strict';

const crypto = require('crypto');
const credentialStore = require('../credentialStore');
const log = require('../../utils/logger');

const API_BASE = 'https://api.telnyx.com/v2';
const HTTP_TIMEOUT_MS = 15000;
const FALLBACK_INBOUND_PER_MIN_USD = 0.0055;
const SIG_TOLERANCE_SEC = 300;

// Ed25519 SubjectPublicKeyInfo (SPKI) header for the 32-byte raw public key.
// Concatenated with the raw key, this becomes a DER-encoded SPKI that
// crypto.createPublicKey accepts. (RFC 8410 §4.)
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function _publicKeyFromBase64(b64) {
  const raw = Buffer.from(String(b64 || ''), 'base64');
  if (raw.length !== 32) throw new Error('telnyx: invalid Ed25519 public key length');
  const der = Buffer.concat([SPKI_ED25519_PREFIX, raw]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

async function _credsFor(credentialId) {
  const c = await credentialStore.get('telnyx', credentialId);
  if (!c.apiKey) throw new Error('Telnyx credentials missing apiKey');
  return c;
}

async function _request(creds, { method, path, query, body }) {
  const url = new URL(`${API_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.append(k, String(v));
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Telnyx ${res.status} ${method} ${path}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Telnyx timeout after ${HTTP_TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const TYPE_MAP = { local: 'local', tollFree: 'toll-free', mobile: 'mobile' };

async function listAvailableNumbers({
  countryCode = 'US', areaCode, contains, numberType = 'local', limit = 20, credentialId = null,
}) {
  const creds = await _credsFor(credentialId);
  const query = {
    'filter[country_code]': String(countryCode || 'US').toUpperCase(),
    'filter[limit]': Math.min(parseInt(limit, 10) || 20, 50),
    'filter[phone_number_type]': TYPE_MAP[numberType] || 'local',
  };
  const ndc = String(areaCode || '').replace(/[^0-9]/g, '');
  if (ndc) query['filter[national_destination_code]'] = ndc;
  const sub = String(contains || '').replace(/[^0-9]/g, '');
  if (sub) query['filter[contains]'] = sub;

  const data = await _request(creds, { method: 'GET', path: '/available_phone_numbers', query });
  const items = Array.isArray(data && data.data) ? data.data : [];
  return items.map((n) => ({
    phoneNumber: n.phone_number,
    friendlyName: n.phone_number,
    locality: (n.region_information && n.region_information[0] && n.region_information[0].region_name) || '',
    region: (n.region_information && n.region_information.find((r) => r.region_type === 'state')
      && n.region_information.find((r) => r.region_type === 'state').region_name) || '',
    isoCountry: countryCode,
    capabilities: (n.features || []).map((f) => f.name),
    monthlyCostUsd: n.cost_information ? parseFloat(n.cost_information.monthly_cost) || 0 : 0,
    upfrontCostUsd: n.cost_information ? parseFloat(n.cost_information.upfront_cost) || 0 : 0,
  }));
}

/**
 * Look up a single available number's cost_information (used at buy-time so
 * we can stash the per-minute rate on the PhoneNumber doc and the monthly
 * cost on the ledger entry).
 */
async function lookupNumberCost({ phoneNumber, credentialId = null }) {
  const creds = await _credsFor(credentialId);
  const data = await _request(creds, {
    method: 'GET',
    path: '/available_phone_numbers',
    query: { 'filter[phone_number]': phoneNumber, 'filter[limit]': 1 },
  });
  const item = (data && data.data && data.data[0]) || null;
  if (!item) return { monthlyCostUsd: 0, upfrontCostUsd: 0 };
  const ci = item.cost_information || {};
  return {
    monthlyCostUsd: parseFloat(ci.monthly_cost) || 0,
    upfrontCostUsd: parseFloat(ci.upfront_cost) || 0,
  };
}

/**
 * Ensure a TeXML Application exists on the Telnyx side and is recorded
 * back on the credential blob so all subsequent buys can reuse it.
 */
async function ensureTexmlApplication(credentialId, { voiceUrl, statusCallback }) {
  const creds = await _credsFor(credentialId);
  if (creds.texmlApplicationId) return creds.texmlApplicationId;

  const created = await _request(creds, {
    method: 'POST',
    path: '/texml_applications',
    body: {
      friendly_name: 'CallTracker (auto)',
      voice_url: voiceUrl,
      voice_method: 'POST',
      status_callback: statusCallback,
      status_callback_method: 'POST',
      active: true,
    },
  });
  const appId = (created && created.data && created.data.id) || null;
  if (!appId) throw new Error('Telnyx: TeXML application creation returned no id');

  // Persist the new id back on the credential record so the next call short-circuits.
  const merged = { ...creds };
  delete merged.id;
  delete merged.provider;
  delete merged.label;
  merged.texmlApplicationId = appId;
  try {
    await credentialStore.update(creds.id, { credentials: merged });
  } catch (e) {
    log.warn({ err: e.message }, 'telnyx: failed to persist texmlApplicationId; will retry next call');
  }
  return appId;
}

async function _findPhoneNumberId(creds, e164) {
  const data = await _request(creds, {
    method: 'GET',
    path: '/phone_numbers',
    query: { 'filter[phone_number]': e164, 'filter[limit]': 1 },
  });
  const item = data && data.data && data.data[0];
  return item ? item.id : null;
}

async function buyNumber({ phoneNumber, voiceUrl, statusCallback, credentialId = null }) {
  const creds = await _credsFor(credentialId);
  const appId = await ensureTexmlApplication(credentialId, { voiceUrl, statusCallback });

  const cost = await lookupNumberCost({ phoneNumber, credentialId });

  await _request(creds, {
    method: 'POST',
    path: '/number_orders',
    body: {
      phone_numbers: [{ phone_number: phoneNumber }],
      connection_id: appId,
    },
  });

  // Telnyx orders complete asynchronously; the phone_number record may need a
  // moment before it appears under /phone_numbers. Poll briefly.
  let phoneNumberId = null;
  for (let i = 0; i < 5 && !phoneNumberId; i += 1) {
    phoneNumberId = await _findPhoneNumberId(creds, phoneNumber);
    if (!phoneNumberId) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!phoneNumberId) throw new Error('Telnyx: purchased number did not appear in inventory');

  // Force the connection binding (the order request usually does this, but
  // patching is idempotent and protects us against eventual-consistency
  // gaps).
  try {
    await _request(creds, {
      method: 'PATCH',
      path: `/phone_numbers/${phoneNumberId}`,
      body: { connection_id: appId },
    });
  } catch (e) {
    log.warn({ err: e.message, phoneNumber }, 'telnyx: connection_id patch failed');
  }

  return {
    credentialId: creds.id,
    providerNumberId: phoneNumberId,
    phoneNumber,
    monthlyPriceUsd: cost.monthlyCostUsd,
    perMinutePriceUsd: FALLBACK_INBOUND_PER_MIN_USD,
  };
}

async function releaseNumber({ providerNumberId, credentialId = null }) {
  const creds = await _credsFor(credentialId);
  await _request(creds, { method: 'DELETE', path: `/phone_numbers/${providerNumberId}` });
}

/**
 * Verify a Telnyx Ed25519 webhook signature.
 *
 * Telnyx signs `${timestamp}|${rawBody}` with an Ed25519 keypair and posts
 * the headers Telnyx-Signature-Ed25519 (base64) and Telnyx-Timestamp
 * (unix seconds). The public key is published on the Telnyx portal and
 * stored on the credential record.
 */
function verifyWebhookSignature({
  rawBody, signatureB64, timestamp, publicKeyB64, toleranceSec = SIG_TOLERANCE_SEC,
}) {
  if (!rawBody || !signatureB64 || !timestamp || !publicKeyB64) return false;
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSec) return false;

  let key;
  try { key = _publicKeyFromBase64(publicKeyB64); }
  catch (_e) { return false; }

  const message = Buffer.concat([
    Buffer.from(String(ts), 'utf8'),
    Buffer.from('|', 'utf8'),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'),
  ]);
  const sig = Buffer.from(String(signatureB64), 'base64');
  try {
    return crypto.verify(null, message, key, sig);
  } catch (_e) {
    return false;
  }
}

module.exports = {
  name: 'telnyx',
  listAvailableNumbers,
  lookupNumberCost,
  buyNumber,
  releaseNumber,
  ensureTexmlApplication,
  verifyWebhookSignature,
};
