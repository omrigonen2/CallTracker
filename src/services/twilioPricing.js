'use strict';

const credentialStore = require('./credentialStore');
const { getClient } = require('../db/redis');
const log = require('../utils/logger');

const CACHE_PREFIX = 'twpricing:';
const CACHE_TTL_S = 24 * 60 * 60; // 24h
const HTTP_TIMEOUT_MS = 15000;

// Node 18+ has global fetch.
const _fetch = global.fetch ? global.fetch.bind(global) : null;
if (!_fetch) {
  throw new Error('global fetch is required (Node 18+)');
}

async function _redisGet(key) {
  try {
    const r = getClient();
    return await r.get(key);
  } catch (e) {
    log.warn({ err: e.message }, 'twilioPricing cache read failed');
    return null;
  }
}

async function _redisSetEx(key, value, ttl) {
  try {
    const r = getClient();
    await r.set(key, value, 'EX', ttl);
  } catch (e) {
    log.warn({ err: e.message }, 'twilioPricing cache write failed');
  }
}

async function _twilioGet(url, accountSid, authToken) {
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await _fetch(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Twilio Pricing ${res.status}: ${body.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Map our buy-flow numberType → Twilio Pricing API key under
 * `phone_number_prices`.  Twilio uses `local`, `national`, `mobile`, `toll free`.
 */
function _twilioTypeKey(numberType) {
  if (numberType === 'tollFree') return 'toll free';
  return numberType || 'local';
}

/**
 * Fetch per-number monthly base prices from Twilio for a country.
 *   GET https://pricing.twilio.com/v1/PhoneNumbers/Countries/{ISO}
 *
 * Returns { iso, prices: [{ numberType, basePrice, currentPrice }] }.
 */
async function listAvailablePrices({ credentialId = null, countryCode }) {
  if (!countryCode) throw new Error('listAvailablePrices: countryCode required');
  const iso = String(countryCode).toUpperCase();
  const cacheKey = `${CACHE_PREFIX}country:${credentialId || 'default'}:${iso}`;

  const cached = await _redisGet(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through */ }
  }

  const c = await credentialStore.get('twilio', credentialId);
  const url = `https://pricing.twilio.com/v1/PhoneNumbers/Countries/${encodeURIComponent(iso)}`;
  const data = await _twilioGet(url, c.accountSid, c.authToken);

  const prices = (data.phone_number_prices || []).map((p) => ({
    numberType: p.number_type, // 'local'|'national'|'mobile'|'toll free'
    basePrice: parseFloat(p.base_price) || 0,
    currentPrice: parseFloat(p.current_price) || 0,
  }));
  const out = { iso, priceUnit: data.price_unit || 'USD', prices };
  await _redisSetEx(cacheKey, JSON.stringify(out), CACHE_TTL_S);
  return out;
}

/**
 * Convenience: get the monthly recurring USD cost for a number-type+country.
 * Falls back to 1.15 USD if Twilio doesn't return a price for that bucket.
 */
async function getNumberMonthlyPriceUsd({ credentialId = null, countryCode, numberType }) {
  const data = await listAvailablePrices({ credentialId, countryCode });
  const want = _twilioTypeKey(numberType);
  const match = data.prices.find((p) => p.numberType === want);
  if (match) return match.currentPrice || match.basePrice || 0;
  if (data.prices.length) return data.prices[0].currentPrice || data.prices[0].basePrice || 0;
  return 1.15;
}

/**
 * Per-minute inbound voice price for a specific destination number.
 *   GET https://pricing.twilio.com/v2/Voice/Numbers/{e164}
 *
 * Returns { e164, inboundCallPriceUsd, country }.
 */
async function getVoicePrice({ credentialId = null, destinationE164 }) {
  if (!destinationE164) throw new Error('getVoicePrice: destinationE164 required');
  const e164 = String(destinationE164).trim();
  const cacheKey = `${CACHE_PREFIX}voice:${credentialId || 'default'}:${e164}`;

  const cached = await _redisGet(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through */ }
  }

  const c = await credentialStore.get('twilio', credentialId);
  const url = `https://pricing.twilio.com/v2/Voice/Numbers/${encodeURIComponent(e164)}`;
  const data = await _twilioGet(url, c.accountSid, c.authToken);

  // The v2 voice number response exposes inbound_call_prices: [{ number_type, base_price, current_price }]
  const inbound = Array.isArray(data.inbound_call_prices) && data.inbound_call_prices.length
    ? data.inbound_call_prices[0]
    : null;
  const out = {
    e164,
    country: data.country || data.iso_country || '',
    inboundCallPriceUsd: inbound ? (parseFloat(inbound.current_price) || parseFloat(inbound.base_price) || 0) : 0,
  };
  await _redisSetEx(cacheKey, JSON.stringify(out), CACHE_TTL_S);
  return out;
}

module.exports = {
  listAvailablePrices,
  getNumberMonthlyPriceUsd,
  getVoicePrice,
};
