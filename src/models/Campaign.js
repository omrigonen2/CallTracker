'use strict';

const mongoose = require('mongoose');
const tenantScope = require('./plugins/tenantScope');

const RoutingRuleSchema = new mongoose.Schema(
  {
    days: [{ type: String, enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }],
    hoursStart: { type: String, default: '00:00' }, // HH:mm
    hoursEnd: { type: String, default: '23:59' },
    forwardTo: { type: String, required: true },
    fallbackTo: { type: String, default: '' },
  },
  { _id: false }
);

const PostbackConfigSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    method: { type: String, enum: ['GET', 'POST'], default: 'POST' },
    triggers: [
      {
        type: String,
        enum: ['call_started', 'call_answered', 'call_completed', 'call_qualified', 'call_tagged'],
      },
    ],
    qualifiedSeconds: { type: Number, default: 60 },
    enabled: { type: Boolean, default: true },
  },
  { _id: true }
);

const CampaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ['active', 'paused'], default: 'active', index: true },
    defaultForwardingNumber: { type: String, default: '' },
    fallbackNumber: { type: String, default: '' },
    timezone: { type: String, default: 'UTC' },
    recordCalls: { type: Boolean, default: true },
    routingRules: [RoutingRuleSchema],
    postbackConfigs: [PostbackConfigSchema],
    whisperEnabled: { type: Boolean, default: false },
    whisperTemplateKey: { type: String, default: 'campaign.whisper.default' },
    ivrEnabled: { type: Boolean, default: false },
    ivrTemplateKey: { type: String, default: 'campaign.ivr.default' },
    qualifiedSeconds: { type: Number, default: 60 },
  },
  { timestamps: true }
);

CampaignSchema.plugin(tenantScope);
CampaignSchema.index({ accountId: 1, createdAt: -1 });

module.exports = mongoose.model('Campaign', CampaignSchema);
