'use strict';

const mongoose = require('mongoose');

const LocalizedTemplateSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null, index: true },
    key: { type: String, required: true, index: true },
    channel: { type: String, enum: ['email', 'sms', 'ivr', 'whisper', 'postback'], required: true, index: true },
    translations: {
      en: { type: String, default: '' },
      he: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

LocalizedTemplateSchema.index({ accountId: 1, channel: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('LocalizedTemplate', LocalizedTemplateSchema);
