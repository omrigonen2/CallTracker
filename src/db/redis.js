'use strict';

const IORedis = require('ioredis');
const config = require('../config');
const log = require('../utils/logger');

let client = null;
let subscriber = null;
let publisher = null;

function getClient() {
  if (!client) {
    client = new IORedis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
    client.on('error', (e) => log.error({ err: e.message }, 'redis error'));
  }
  return client;
}

function getSubscriber() {
  if (!subscriber) {
    subscriber = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  }
  return subscriber;
}

function getPublisher() {
  if (!publisher) {
    publisher = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  }
  return publisher;
}

module.exports = { getClient, getSubscriber, getPublisher };
