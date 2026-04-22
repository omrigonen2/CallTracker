'use strict';

const mongoose = require('mongoose');

const MembershipSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    roleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }],
    status: { type: String, enum: ['active', 'invited', 'disabled'], default: 'active', index: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

MembershipSchema.index({ accountId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Membership', MembershipSchema);
