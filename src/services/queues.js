'use strict';

const { Queue, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const config = require('../config');

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

const postbackQueue = new Queue('postbacks', { connection });
const emailQueue = new Queue('emails', { connection });

module.exports = {
  connection,
  postbackQueue,
  emailQueue,
};
