'use strict';

const { connect } = require('../db/mongo');
const log = require('../utils/logger');

(async () => {
  await connect();
  require('./postbacks').start();
  require('./emails').start();
  log.info('workers running: postbacks, emails');
})();
