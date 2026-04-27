'use strict';
/**
 * One-off: lookup a number in PhoneNumber + Campaign (no secrets in output).
 * Usage: node scripts/diag-phone-lookup.js +97243761941
 */
require('dotenv').config();
const mongoose = require('mongoose');
const PhoneNumber = require('../src/models/PhoneNumber');
const Campaign = require('../src/models/Campaign');

const raw = process.argv[2] || '+97243761941';
const variants = Array.from(
  new Set([raw, raw.replace(/^\+/, ''), `+${raw.replace(/^\+/, '')}`].filter(Boolean))
);

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  await mongoose.connect(uri);
  for (const v of variants) {
    const n = await PhoneNumber.findOne({ phoneNumber: v }).setOptions({ skipTenantScope: true }).lean();
    if (n) {
      const camp = n.campaignId
        ? await Campaign.findById(n.campaignId).setOptions({ skipTenantScope: true }).lean()
        : null;
      console.log('MATCH phoneNumber field:', JSON.stringify(n.phoneNumber));
      console.log('  accountId:', String(n.accountId));
      console.log('  campaignId:', n.campaignId ? String(n.campaignId) : null);
      console.log('  provider:', n.provider, 'status:', n.status);
      console.log('  providerCredentialId:', n.providerCredentialId ? String(n.providerCredentialId) : 'null');
      console.log('  forwardingOverride:', n.forwardingOverride || '(empty)');
      if (camp) {
        console.log('  campaign.name:', camp.name);
        console.log('  campaign.defaultForwardingNumber:', camp.defaultForwardingNumber || '(empty)');
        console.log('  campaign.fallbackNumber:', camp.fallbackNumber || '(empty)');
        console.log('  campaign.timezone:', camp.timezone);
        console.log('  campaign.ivrEnabled:', camp.ivrEnabled);
        console.log('  campaign.routingRules count:', (camp.routingRules || []).length);
        console.log('  campaign.postbackConfigs:', (camp.postbackConfigs || []).length);
      } else {
        console.log('  campaign: (none)');
      }
      await mongoose.disconnect();
      return;
    }
  }
  console.log('No PhoneNumber found for variants:', variants.join(', '));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
