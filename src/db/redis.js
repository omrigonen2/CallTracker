'use strict';

const IORedis = require('ioredis');
const config = require('../config');
const log = require('../utils/logger');

let client = null;
let subscriber = null;
let publisher = null;

// Tolerate a REDIS_URL that was accidentally set with surrounding quotes
// (e.g. copied from a .env line like `REDIS_URL="redis://..."`).
function cleanUrl(url) {
  if (!url) return url;
  let s = String(url).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s;
}

// Common options: short connect timeout, bounded retry/backoff so a broken
// Redis surfaces as an error instead of hanging request handlers forever.
const COMMON_OPTS = {
  connectTimeout: 5000,
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 200, 2000),
  reconnectOnError: () => false,
};

function getClient() {
  if (!client) {
    client = new IORedis(cleanUrl(config.redisUrl), COMMON_OPTS);
    client.on('error', (e) => log.error({ err: e.message }, 'redis error'));
  }
  return client;
}

function getSubscriber() {
  if (!subscriber) {
    subscriber = new IORedis(cleanUrl(config.redisUrl), { ...COMMON_OPTS, maxRetriesPerRequest: null });
    subscriber.on('error', (e) => log.error({ err: e.message }, 'redis sub error'));
  }
  return subscriber;
}

function getPublisher() {
  if (!publisher) {
    publisher = new IORedis(cleanUrl(config.redisUrl), COMMON_OPTS);
    publisher.on('error', (e) => log.error({ err: e.message }, 'redis pub error'));
  }
  return publisher;
}

module.exports = { getClient, getSubscriber, getPublisher };
