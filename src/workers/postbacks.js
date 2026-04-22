'use strict';

const { Worker } = require('bullmq');
const { connection } = require('../services/queues');
const PostbackLog = require('../models/PostbackLog');
const log = require('../utils/logger');

function buildUrl(url, payload, method) {
  if (method !== 'GET') return url;
  const u = new URL(url);
  Object.entries(payload || {}).forEach(([k, v]) => u.searchParams.set(k, String(v ?? '')));
  return u.toString();
}

async function deliver(job) {
  const { accountId, campaignId, callId, postback, trigger, payload } = job.data;
  const method = postback.method || 'POST';
  const url = buildUrl(postback.url, payload, method);
  let responseStatus = 0;
  let responseBody = '';
  let success = false;
  let error = '';
  try {
    const init = { method, headers: { 'content-type': 'application/json' } };
    if (method !== 'GET') init.body = JSON.stringify(payload);
    const r = await fetch(url, init);
    responseStatus = r.status;
    responseBody = (await r.text()).slice(0, 4000);
    success = r.ok;
    if (!success) error = `HTTP ${r.status}`;
  } catch (e) {
    error = e.message;
  }
  await PostbackLog.create({
    accountId,
    campaignId,
    callId,
    postbackName: postback.name,
    trigger,
    url,
    method,
    requestBody: payload,
    responseStatus,
    responseBody,
    success,
    attempt: job.attemptsMade + 1,
    error,
  });
  if (!success) throw new Error(error || 'postback failed');
}

function start() {
  const worker = new Worker('postbacks', deliver, { connection, concurrency: 10 });
  worker.on('failed', (job, err) => log.warn({ err: err.message, attempts: job.attemptsMade }, 'postback failed'));
  worker.on('completed', (job) => log.debug({ id: job.id }, 'postback delivered'));
  return worker;
}

module.exports = { start };
