'use strict';

require('dotenv').config();

function required(name, fallback) {
  let v = process.env[name];
  if (v === undefined || v === null || v === '') v = fallback;
  if (v === undefined || v === null || v === '') {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

const env = process.env.NODE_ENV || 'development';

module.exports = {
  env,
  isProd: env === 'production',
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,

  jwtSecret: required('JWT_SECRET', env === 'production' ? undefined : 'dev-jwt-secret-change-me'),
  masterKey: required(
    'MASTER_ENCRYPTION_KEY',
    env === 'production' ? undefined : 'ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGV2ZGU=' // 32 bytes base64 (dev only)
  ),

  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/calltracker',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET || '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },

  cookie: {
    name: 'ct_session',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },

  locales: ['en', 'he'],
  defaultLocale: 'en',
  rtlLocales: ['he', 'ar'],
};
