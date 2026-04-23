'use strict';

const twilio = require('./twilio');
const telnyx = require('./telnyx');

const providers = { twilio, telnyx };

function get(name) {
  const p = providers[name];
  if (!p) throw new Error(`Unknown provider ${name}`);
  return p;
}

function list() {
  return Object.keys(providers);
}

module.exports = { get, list };
