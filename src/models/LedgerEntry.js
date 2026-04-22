'use strict';

const mongoose = require('mongoose');
const tenantScope = require('./plugins/tenantScope');

const LEDGER_KINDS = [
  'topup',
  'number_purchase',
  'number_monthly',
  'call_charge',
  'adjustment',
  'refund',
];

const LedgerEntrySchema = new mongoose.Schema(
  {
    kind: { type: String, enum: LEDGER_KINDS, required: true, index: true },
    credits: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    ref: {
      phoneNumberId: { type: mongoose.Schema.Types.ObjectId, ref: 'PhoneNumber', default: null },
      callId: { type: mongoose.Schema.Types.ObjectId, ref: 'Call', default: null },
      providerCredentialId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderCredential', default: null },
      externalChargeId: { type: String, default: null },
    },
    metadata: {
      providerCostUsd: { type: Number, default: null },
      marginMode: { type: String, default: null },
      marginValue: { type: Number, default: null },
      twilioRateRef: { type: String, default: null },
      country: { type: String, default: null },
      durationSec: { type: Number, default: null },
      note: { type: String, default: null },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

LedgerEntrySchema.plugin(tenantScope);
LedgerEntrySchema.index({ accountId: 1, createdAt: -1 });

LedgerEntrySchema.statics.KINDS = LEDGER_KINDS;

module.exports = mongoose.model('LedgerEntry', LedgerEntrySchema);
