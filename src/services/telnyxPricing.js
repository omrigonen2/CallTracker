'use strict';

const telnyxAdapter = require('./providers/telnyx');
const { getClient } = require('../db/redis');
const log = require('../utils/logger');

const CACHE_PREFIX = 'txpricing:';
const CACHE_TTL_S = 24 * 60 * 60;
const FALLBACK_MONTHLY_USD = 1.0;

const TYPE_MAP = { local: 'local', tollFree: 'toll-free', mobile: 'mobile' };

async function _redisGet(key) {
  try { return await getClient().get(key); }
  catch (e) { log.warn({ err: e.message }, 'telnyxPricing cache read failed'); return null; }
}
async function _redisSetEx(key, value, ttl) {
  try { await getClient().set(key, value, 'EX', ttl); }
  catch (e) { log.warn({ err: e.message }, 'telnyxPricing cache write failed'); }
}

/**
 * Resolve the per-month USD cost for a number on Telnyx.
 *
 * Two modes:
 *   1. `phoneNumber` is given (buy-time): fetch that exact number's
 *      cost_information.
 *   2. `phoneNumber` is null (price preview): sample one available number
 *      for the requested country/type and use its cost as a representative.
 */
async function getNumberMonthlyPriceUsd({
  credentialId = null, countryCode, numberType = 'local', phoneNumber = null,
}) {
  if (!countryCode) throw new Error('telnyxPricing.getNumberMonthlyPriceUsd: countryCode required');
  const iso = String(countryCode).toUpperCase();
  const type = TYPE_MAP[numberType] || 'local';
  const cacheKey = phoneNumber
    ? `${CACHE_PREFIX}num:${credentialId || 'default'}:${phoneNumber}`
    : `${CACHE_PREFIX}sample:${credentialId || 'default'}:${iso}:${type}`;

  const cached = await _redisGet(cacheKey);
  if (cached) {
    const v = parseFloat(cached);
    if (Number.isFinite(v)) return v;
  }

  let usd;
  if (phoneNumber) {
    const cost = await telnyxAdapter.lookupNumberCost({ credentialId, phoneNumber });
    usd = cost.monthlyCostUsd || 0;
  } else {
    const sample = await telnyxAdapter.listAvailableNumbers({
      credentialId, countryCode: iso, numberType, limit: 1,
    });
    usd = sample.length ? (sample[0].monthlyCostUsd || 0) : 0;
  }
  if (!usd || usd <= 0) usd = FALLBACK_MONTHLY_USD;

  await _redisSetEx(cacheKey, String(usd), CACHE_TTL_S);
  return usd;
}

module.exports = { getNumberMonthlyPriceUsd };
