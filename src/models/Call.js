'use strict';

const mongoose = require('mongoose');
const tenantScope = require('./plugins/tenantScope');

const CallSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', index: true },
    phoneNumberId: { type: mongoose.Schema.Types.ObjectId, ref: 'PhoneNumber', index: true },
    providerCallId: { type: String, index: true },
    callerNumber: { type: String, index: true },
    destinationNumber: { type: String },
    startTime: { type: Date },
    answerTime: { type: Date, default: null },
    endTime: { type: Date },
    duration: { type: Number, default: 0 },
    status: { type: String, enum: ['ringing', 'in-progress', 'completed', 'missed', 'failed', 'no-answer', 'busy'], default: 'ringing', index: true },
    recordingUrl: { type: String, default: '' },
    recordingDurationSec: { type: Number, default: 0 },
    tags: [{ type: String }],
    outcome: { type: String, enum: ['', 'converted', 'not_relevant', 'spam'], default: '' },
    notes: { type: String, default: '' },
    score: { type: Number, default: 0 },
    qualified: { type: Boolean, default: false, index: true },
    isDuplicateCaller: { type: Boolean, default: false },
    billedSeconds: { type: Number, default: 0 },
    providerCostUsd: { type: Number, default: 0 },
    chargedCredits: { type: Number, default: 0 },
  },
  { timestamps: true }
);

CallSchema.plugin(tenantScope);
CallSchema.index({ accountId: 1, createdAt: -1 });
CallSchema.index({ accountId: 1, campaignId: 1, createdAt: -1 });
CallSchema.index({ accountId: 1, callerNumber: 1 });

module.exports = mongoose.model('Call', CallSchema);
