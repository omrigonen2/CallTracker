'use strict';

const { connect } = require('./db/mongo');
const config = require('./config');
const log = require('./utils/logger');
const { seedSystemRoles } = require('./seeds/roles');
const { build } = require('./app');
const crypto = require('./config/crypto');

(async () => {
  // Validate encryption key at boot.
  try { crypto.encrypt({ probe: true }); } catch (e) {
    log.error({ err: e.message }, 'crypto self-check failed');
    process.exit(1);
  }
  await connect();
  await seedSystemRoles().catch((e) => log.warn({ err: e.message }, 'seed roles failed'));
  const app = await build();
  app.listen(config.port, () => log.info({ port: config.port, env: config.env }, 'http server listening'));
})().catch((e) => { log.error({ err: e.message, stack: e.stack }, 'startup failed'); process.exit(1); });
