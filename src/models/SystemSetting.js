'use strict';

const mongoose = require('mongoose');
const tenantScope = require('./plugins/tenantScope');

const BillingSettingsSchema = new mongoose.Schema(
  {
    creditUsdRate: { type: Number, default: 0.01, min: 0.000001 },
  },
  { _id: false }
);

const MailSettingsSchema = new mongoose.Schema(
  {
    provider: { type: String, default: 'resend', enum: ['resend'] },
    apiKeyEncrypted: { type: String, default: '' },
    apiKeyMask: { type: String, default: '' },
    fromEmail: { type: String, default: '' },
    replyTo: { type: String, default: '' },
  },
  { _id: false }
);

const SystemSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true, required: true },
    billing: { type: BillingSettingsSchema, default: () => ({}) },
    mail: { type: MailSettingsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

SystemSettingSchema.plugin(tenantScope, { skip: true });

SystemSettingSchema.statics.getOrCreate = async function getOrCreate() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) {
    try {
      doc = await this.create({ key: 'global' });
    } catch (e) {
      if (e && e.code === 11000) {
        doc = await this.findOne({ key: 'global' });
      } else {
        throw e;
      }
    }
  }
  return doc;
};

module.exports = mongoose.model('SystemSetting', SystemSettingSchema);
