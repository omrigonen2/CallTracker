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
  const sub = getSubscriber();
  sub.subscribe(INVALIDATE_CHANNEL, (err) => {
    if (err) log.error({ err: err.message }, 'cred sub failed');
  });
  sub.on('message', (channel, message) => {
    if (channel !== INVALIDATE_CHANNEL) return;
    log.debug({ key: message }, 'invalidating credential cache');
    memCache.delete(message);
    getClient().del(`${CACHE_PREFIX}${message}`).catch(() => {});
  });
}

async function publishInvalidate(key) {
  await getPublisher().publish(INVALIDATE_CHANNEL, key);
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
  initSubscriber();
  const cacheKey = credentialId ? `${provider}:${credentialId}` : `${provider}:default`;

  if (memCache.has(cacheKey)) return memCache.get(cacheKey);

  const redis = getClient();
  const cached = await redis.get(`${CACHE_PREFIX}${cacheKey}`);
  if (cached) {
    const parsed = JSON.parse(cached);
    memCache.set(cacheKey, parsed);
    return parsed;
  }

  const doc = credentialId
    ? await ProviderCredential.findById(credentialId)
    : await getDefaultCredentialDoc(provider);
  if (!doc) throw new Error(`No provider credential available for ${provider}`);

  const decrypted = decrypt(doc.credentialsEncrypted);
  const value = { id: String(doc._id), provider: doc.provider, label: doc.label, ...decrypted };
  await redis.set(`${CACHE_PREFIX}${cacheKey}`, JSON.stringify(value), 'EX', CACHE_TTL_S);
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
  await publishInvalidate(`${provider}:default`);
  if (id) await publishInvalidate(`${provider}:${id}`);
  memCache.delete(`${provider}:default`);
  if (id) memCache.delete(`${provider}:${id}`);
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
