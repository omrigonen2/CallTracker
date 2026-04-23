'use strict';

const mongoose = require('mongoose');

const MarginSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
    value: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const ProviderCredentialSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, enum: ['twilio', 'telnyx'], index: true },
    label: { type: String, required: true, trim: true },
    credentialsEncrypted: { type: String, required: true },
    isDefault: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rotatedAt: { type: Date, default: null },
    margins: {
      numberPurchase: { type: MarginSchema, default: () => ({}) },
      numberMonthly: { type: MarginSchema, default: () => ({}) },
      callPerMinute: { type: MarginSchema, default: () => ({}) },
    },
  },
  { timestamps: true }
);

ProviderCredentialSchema.index({ provider: 1, isDefault: 1 });

module.exports = mongoose.model('ProviderCredential', ProviderCredentialSchema);
