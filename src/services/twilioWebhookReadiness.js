'use strict';

const config = require('../config');
const PhoneNumber = require('../models/PhoneNumber');
const ProviderCredential = require('../models/ProviderCredential');

/**
 * Invariants for Twilio voice webhooks (signature = auth token of the subaccount
 * that owns the number, not necessarily the "default" provider in admin).
 */
async function checkTwilioWebhookReadiness() {
  const issues = [];

  const anyTwilioCred = await ProviderCredential.findOne({ provider: 'twilio' }).lean();
  const nums = await PhoneNumber.find({ provider: 'twilio', status: 'active' })
    .setOptions({ skipTenantScope: true })
    .select('phoneNumber providerCredentialId')
    .lean();

  if (nums.length && !anyTwilioCred) {
    issues.push('Active Twilio phone number(s) exist but no Twilio provider credential is configured.');
  }

  for (const n of nums) {
    if (!n.providerCredentialId) continue; // uses default cred; `anyTwilioCred` already required above
    const c = await ProviderCredential.findById(n.providerCredentialId).lean();
    if (!c) {
      issues.push(
        `Number ${n.phoneNumber}: providerCredentialId ${n.providerCredentialId} not found (webhook signature validation will fail).`
      );
    } else if (c.provider !== 'twilio') {
      issues.push(`Number ${n.phoneNumber}: linked credential is not a Twilio credential.`);
    }
  }

  if (config.isProd) {
    const base = (config.baseUrl || '').toLowerCase();
    if (base.startsWith('http://') && !base.includes('localhost') && !base.includes('127.0.0.1')) {
      issues.push(
        'APP_BASE_URL uses http in production; prefer https so Twilio and proxies agree on the public URL (signature URL fallback).'
      );
    }
    if (base.includes('localhost') || base.includes('127.0.0.1')) {
      issues.push('APP_BASE_URL is localhost/127.0.0.1 in production; set it to the public https URL of this service.');
    }
  }

  return { ok: issues.length === 0, issues };
}

module.exports = { checkTwilioWebhookReadiness };
