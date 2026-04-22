'use strict';

const mongoose = require('mongoose');
const tenantScope = require('./plugins/tenantScope');

const PhoneNumberSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null, index: true },
    provider: { type: String, enum: ['twilio'], required: true },
    providerCredentialId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderCredential' },
    providerNumberId: { type: String, default: '' },
    phoneNumber: { type: String, required: true, index: true },
    friendlyName: { type: String, default: '' },
    status: { type: String, enum: ['active', 'released'], default: 'active', index: true },
    forwardingOverride: { type: String, default: '' },
    countryCode: { type: String, default: '' },
    monthlyCostCredits: { type: Number, default: 0 },
    purchasedCostCredits: { type: Number, default: 0 },
  },
  { timestamps: true }
);

PhoneNumberSchema.plugin(tenantScope);
PhoneNumberSchema.index({ accountId: 1, campaignId: 1 });
PhoneNumberSchema.index({ phoneNumber: 1 }, { unique: true });

module.exports = mongoose.model('PhoneNumber', PhoneNumberSchema);
