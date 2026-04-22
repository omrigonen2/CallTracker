'use strict';

const SystemSetting = require('../models/SystemSetting');
const log = require('../utils/logger');

const TTL_MS = 30_000;
const DEFAULT_RATE = 0.01;

let cached = null;
let cachedAt = 0;

async function get() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  try {
    const doc = await SystemSetting.getOrCreate();
    cached = doc;
    cachedAt = Date.now();
    return cached;
  } catch (e) {
    log.warn({ err: e.message }, 'systemSettings load failed; using defaults');
    return { billing: { creditUsdRate: DEFAULT_RATE } };
  }
}

function invalidate() {
  cached = null;
  cachedAt = 0;
}

async function getCreditUsdRate() {
  const s = await get();
  const rate = Number(s && s.billing && s.billing.creditUsdRate);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_RATE;
}

module.exports = { get, invalidate, getCreditUsdRate, DEFAULT_RATE };
