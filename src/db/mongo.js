'use strict';

const mongoose = require('mongoose');
const config = require('../config');
const log = require('../utils/logger');

mongoose.set('strictQuery', true);

async function connect() {
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 10000,
  });
  log.info({ uri: config.mongoUri.replace(/\/\/.*@/, '//***@') }, 'mongo connected');
  return mongoose.connection;
}

module.exports = { connect, mongoose };
