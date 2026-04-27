'use strict';
/**
 * Exit 0 if Twilio webhook invariants hold, 1 otherwise (for CI / pre-deploy).
 */
require('dotenv').config();
const { connect } = require('../src/db/mongo');
const { checkTwilioWebhookReadiness } = require('../src/services/twilioWebhookReadiness');
const mongoose = require('mongoose');

(async () => {
  await connect();
  const { ok, issues } = await checkTwilioWebhookReadiness();
  for (const line of issues) {
    /* eslint-disable no-console */
    console.error(`[twilio-readiness] ${line}`);
  }
  await mongoose.disconnect();
  if (!ok) {
    process.exit(1);
  }
  /* eslint-disable no-console */
  console.log('[twilio-readiness] ok');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
