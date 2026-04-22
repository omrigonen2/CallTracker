'use strict';

const mongoose = require('mongoose');

const ProviderCredentialSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, enum: ['twilio'], index: true },
    label: { type: String, required: true, trim: true },
    credentialsEncrypted: { type: String, required: true },
    isDefault: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rotatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ProviderCredentialSchema.index({ provider: 1, isDefault: 1 });

module.exports = mongoose.model('ProviderCredential', ProviderCredentialSchema);
