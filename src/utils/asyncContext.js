'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();

function runWith(ctx, fn) {
  return als.run(ctx, fn);
}

function get() {
  return als.getStore() || {};
}

function set(key, value) {
  const store = als.getStore();
  if (store) store[key] = value;
}

function getAccountId() {
  const s = als.getStore();
  return s ? s.accountId : null;
}

function getUserId() {
  const s = als.getStore();
  return s ? s.userId : null;
}

module.exports = { als, runWith, get, set, getAccountId, getUserId };
