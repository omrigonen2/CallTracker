'use strict';

const mongoose = require('mongoose');
const tenantScope = require('./plugins/tenantScope');

const PostbackLogSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', index: true },
    callId: { type: mongoose.Schema.Types.ObjectId, ref: 'Call' },
    postbackName: { type: String },
    trigger: { type: String },
    url: { type: String },
    method: { type: String },
    requestBody: { type: mongoose.Schema.Types.Mixed },
    responseStatus: { type: Number, default: 0 },
    responseBody: { type: String, default: '' },
    success: { type: Boolean, default: false, index: true },
    attempt: { type: Number, default: 1 },
    error: { type: String, default: '' },
  },
  { timestamps: true }
);

PostbackLogSchema.plugin(tenantScope);
PostbackLogSchema.index({ accountId: 1, createdAt: -1 });

module.exports = mongoose.model('PostbackLog', PostbackLogSchema);
