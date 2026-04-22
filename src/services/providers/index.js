'use strict';

const twilio = require('./twilio');

const providers = { twilio };

function get(name) {
  const p = providers[name];
  if (!p) throw new Error(`Unknown provider ${name}`);
  return p;
}

function list() {
  return Object.keys(providers);
}

module.exports = { get, list };
