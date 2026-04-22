'use strict';

const mongoose = require('mongoose');
const tenantScope = require('./plugins/tenantScope');

const CallerProfileSchema = new mongoose.Schema(
  {
    phoneNumber: { type: String, required: true, index: true },
    totalCalls: { type: Number, default: 0 },
    lastCallAt: { type: Date, default: null },
    isBlacklisted: { type: Boolean, default: false, index: true },
    isWhitelisted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

CallerProfileSchema.plugin(tenantScope);
CallerProfileSchema.index({ accountId: 1, phoneNumber: 1 }, { unique: true });

module.exports = mongoose.model('CallerProfile', CallerProfileSchema);
