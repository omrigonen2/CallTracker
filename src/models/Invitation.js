'use strict';

const mongoose = require('mongoose');

const InvitationSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    roleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }],
    token: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'accepted', 'expired', 'revoked'], default: 'pending', index: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Invitation', InvitationSchema);
