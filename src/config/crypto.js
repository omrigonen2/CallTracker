'use strict';

const crypto = require('crypto');
const config = require('./index');

const ALG = 'aes-256-gcm';

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const raw = String(config.masterKey || '').trim().replace(/^['"]|['"]$/g, '');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `MASTER_ENCRYPTION_KEY must be 32 bytes when base64-decoded ` +
      `(got ${key.length} bytes from a ${raw.length}-char value). ` +
      `Generate a fresh key with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  cachedKey = key;
  return key;
}

function encrypt(plaintextObj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, getKey(), iv);
  const data = Buffer.from(JSON.stringify(plaintextObj), 'utf8');
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(payloadB64) {
  const buf = Buffer.from(payloadB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALG, getKey(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

module.exports = { encrypt, decrypt };
