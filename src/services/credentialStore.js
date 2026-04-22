'use strict';

const ProviderCredential = require('../models/ProviderCredential');
const { decrypt, encrypt } = require('../config/crypto');
const { getClient, getSubscriber, getPublisher } = require('../db/redis');
const log = require('../utils/logger');

const CACHE_PREFIX = 'cred:';
const CACHE_TTL_S = 300;
const INVALIDATE_CHANNEL = 'provider:credentials:invalidate';

const memCache = new Map(); // local in-process cache, invalidated by pub/sub

let subInitialized = false;
function initSubscriber() {
  if (subInitialized) return;
  subInitialized = true;
  let sub;
  try { sub = getSubscriber(); } catch (e) {
    log.warn({ err: e.message }, 'cred subscriber init failed');
    return;
  }
  sub.subscribe(INVALIDATE_CHANNEL, (err) => {
    if (err) log.warn({ err: err.message }, 'cred sub subscribe failed');
  });
  sub.on('message', (channel, message) => {
    if (channel !== INVALIDATE_CHANNEL) return;
    log.debug({ key: message }, 'invalidating credential cache');
    memCache.delete(message);
    try { getClient().del(`${CACHE_PREFIX}${message}`).catch(() => {}); } catch (_e) { /* noop */ }
  });
  sub.on('error', (e) => log.warn({ err: e.message }, 'cred subscriber error'));
}

async function publishInvalidate(key) {
  // Best-effort: if Redis is unreachable, the local memCache invalidation in
  // `invalidate()` is still authoritative for this process. Other processes
  // will see stale data until their TTL expires; that's acceptable.
  try {
    const pub = getPublisher();
    await pub.publish(INVALIDATE_CHANNEL, key);
  } catch (e) {
    log.warn({ err: e.message, key }, 'cred invalidate publish failed');
  }
}

async function getDefaultCredentialDoc(provider) {
  let doc = await ProviderCredential.findOne({ provider, isDefault: true });
  if (!doc) doc = await ProviderCredential.findOne({ provider }).sort({ createdAt: -1 });
  return doc;
}

/**
 * Return decrypted credentials for a provider. Cached in Redis + memory.
 *
 * @param {string} provider
 * @param {string|null} credentialId (optional explicit id)
 */
async function get(provider, credentialId = null) {
  try { initSubscriber(); } catch (e) { log.warn({ err: e.message }, 'cred subscriber init failed'); }
  const cacheKey = credentialId ? `${provider}:${credentialId}` : `${provider}:default`;

  if (memCache.has(cacheKey)) return memCache.get(cacheKey);

  // Redis is best-effort cache; never let it block credential lookup.
  let redis = null;
  try { redis = getClient(); } catch (e) { log.warn({ err: e.message }, 'redis client init failed'); }
  if (redis) {
    try {
      const cached = await redis.get(`${CACHE_PREFIX}${cacheKey}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        memCache.set(cacheKey, parsed);
        return parsed;
      }
    } catch (e) {
      log.warn({ err: e.message }, 'cred cache read failed');
    }
  }

  const doc = credentialId
    ? await ProviderCredential.findById(credentialId)
    : await getDefaultCredentialDoc(provider);
  if (!doc) throw new Error(`No provider credential available for ${provider}`);

  const decrypted = decrypt(doc.credentialsEncrypted);
  const value = { id: String(doc._id), provider: doc.provider, label: doc.label, ...decrypted };
  if (redis) {
    redis.set(`${CACHE_PREFIX}${cacheKey}`, JSON.stringify(value), 'EX', CACHE_TTL_S)
      .catch((e) => log.warn({ err: e.message }, 'cred cache write failed'));
  }
  memCache.set(cacheKey, value);
  return value;
}

async function create({ provider, label, credentials, isDefault, createdBy }) {
  if (isDefault) await ProviderCredential.updateMany({ provider, isDefault: true }, { isDefault: false });
  const doc = await ProviderCredential.create({
    provider,
    label,
    credentialsEncrypted: encrypt(credentials),
    isDefault: !!isDefault,
    createdBy,
  });
  await invalidate(provider);
  return doc;
}

async function update(id, { label, credentials, isDefault }) {
  const doc = await ProviderCredential.findById(id);
  if (!doc) throw new Error('Credential not found');
  if (label !== undefined) doc.label = label;
  if (credentials) {
    doc.credentialsEncrypted = encrypt(credentials);
    doc.rotatedAt = new Date();
  }
  if (isDefault !== undefined) {
    if (isDefault) await ProviderCredential.updateMany({ provider: doc.provider, isDefault: true }, { isDefault: false });
    doc.isDefault = !!isDefault;
  }
  await doc.save();
  await invalidate(doc.provider, String(doc._id));
  return doc;
}

async function remove(id) {
  const doc = await ProviderCredential.findById(id);
  if (!doc) return;
  await doc.deleteOne();
  await invalidate(doc.provider, String(doc._id));
}

async function invalidate(provider, id = null) {
  // Always purge our local memory cache first; this can never fail.
  memCache.delete(`${provider}:default`);
  if (id) memCache.delete(`${provider}:${id}`);
  // Then best-effort broadcast to other processes.
  await publishInvalidate(`${provider}:default`);
  if (id) await publishInvalidate(`${provider}:${id}`);
}

async function listSafe(provider = null) {
  const q = provider ? { provider } : {};
  const docs = await ProviderCredential.find(q).sort({ createdAt: -1 }).lean();
  return docs.map((d) => ({
    _id: d._id,
    provider: d.provider,
    label: d.label,
    isDefault: d.isDefault,
    rotatedAt: d.rotatedAt,
    createdAt: d.createdAt,
  }));
}

module.exports = { get, create, update, remove, listSafe, invalidate };
