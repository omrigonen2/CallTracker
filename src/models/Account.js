'use strict';

const mongoose = require('mongoose');

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
  },
  { timestamps: true }
);

module.exports = mongoose.model('Account', AccountSchema);
