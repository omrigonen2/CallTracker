'use strict';

const mongoose = require('mongoose');

const MarginOverrideSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    mode: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
    value: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const AccountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active', index: true },
    defaultLocale: { type: String, enum: ['en', 'he'], default: 'en' },
    timezone: { type: String, default: 'UTC' },
    defaultCountry: { type: String, default: 'US', uppercase: true, trim: true },
    plan: { type: String, enum: ['free', 'starter', 'pro', 'enterprise'], default: 'free' },
    limits: {
      numbers: { type: Number, default: 100 },
      users: { type: Number, default: 25 },
      callsPerMonth: { type: Number, default: 100000 },
    },
    providers: {
      primaryCredentialId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderCredential', default: null },
      fallbackCredentialId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderCredential', default: null },
      marginOverride: {
        numberPurchase: { type: MarginOverrideSchema, default: () => ({}) },
        numberMonthly: { type: MarginOverrideSchema, default: () => ({}) },
        callPerMinute: { type: MarginOverrideSchema, default: () => ({}) },
      },
    },
    credits: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Account', AccountSchema);
