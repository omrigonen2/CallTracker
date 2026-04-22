'use strict';

const { postbackQueue } = require('./queues');

/**
 * Enqueue a postback delivery for a call/event.
 *
 * Workers handle retry (3 attempts exponential backoff) + logging.
 */
async function dispatch({ accountId, campaignId, callId, postback, trigger, payload }) {
  await postbackQueue.add(
    'postback',
    { accountId, campaignId, callId, postback, trigger, payload },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    }
  );
}

module.exports = { dispatch };
