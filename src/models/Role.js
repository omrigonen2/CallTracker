'use strict';

const mongoose = require('mongoose');

const RoleSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null, index: true }, // null = system
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, trim: true, lowercase: true },
    permissions: [{ type: String }],
    isSystem: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

RoleSchema.index({ accountId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('Role', RoleSchema);
