'use strict';

const { connect } = require('./db/mongo');
const config = require('./config');
const log = require('./utils/logger');
const { seedSystemRoles } = require('./seeds/roles');
const { build } = require('./app');
const crypto = require('./config/crypto');
const { checkTwilioWebhookReadiness } = require('./services/twilioWebhookReadiness');

(async () => {
  // Validate encryption key at boot.
  try { crypto.encrypt({ probe: true }); } catch (e) {
    log.error({ err: e.message }, 'crypto self-check failed');
    process.exit(1);
  }
  await connect();
  const twilioReadiness = await checkTwilioWebhookReadiness();
  if (!twilioReadiness.ok) {
    log.error(
      { issues: twilioReadiness.issues, event: 'twilio_webhook_readiness_failed' },
      'twilio_webhook_readiness: configuration issues — voice webhooks may fail'
    );
    if (process.env.TWILIO_STRICT_READINESS === '1') {
      process.exit(1);
    }
  }
  await seedSystemRoles().catch((e) => log.warn({ err: e.message }, 'seed roles failed'));
  const app = await build();
  app.listen(config.port, () => log.info({ port: config.port, env: config.env }, 'http server listening'));
})().catch((e) => { log.error({ err: e.message, stack: e.stack }, 'startup failed'); process.exit(1); });
