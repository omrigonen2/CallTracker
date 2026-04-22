'use strict';

const { Worker } = require('bullmq');
const { connection } = require('../services/queues');
const { send } = require('../services/email');
const log = require('../utils/logger');

function start() {
  const worker = new Worker(
    'emails',
    async (job) => {
      await send(job.data);
    },
    { connection, concurrency: 5 }
  );
  worker.on('failed', (job, err) => log.warn({ err: err.message }, 'email failed'));
  return worker;
}

module.exports = { start };
