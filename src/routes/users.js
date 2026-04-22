'use strict';

const express = require('express');
const crypto = require('crypto');
const Membership = require('../models/Membership');
const User = require('../models/User');
const Role = require('../models/Role');
const Invitation = require('../models/Invitation');
const { requirePermission } = require('../middleware/rbac');
const { send } = require('../services/email');
const audit = require('../services/audit');
const config = require('../config');

const router = express.Router();

router.get('/', requirePermission('users.read'), async (req, res, next) => {
  try {
    const memberships = await Membership.find({ accountId: req.account._id })
      .populate('userId', 'email name lastLoginAt')
      .populate('roleIds', 'name key')
      .lean();
    const invitations = await Invitation.find({ accountId: req.account._id, status: 'pending' }).populate('roleIds', 'name').lean();
    res.render('users/list', { memberships, invitations });
  } catch (e) { next(e); }
});

router.get('/invite', requirePermission('users.invite'), async (req, res, next) => {
  try {
    const roles = await Role.find({ $or: [{ accountId: req.account._id }, { accountId: null, isSystem: true, key: { $ne: 'super_admin' } }] }).lean();
    res.render('users/invite', { roles, error: null });
  } catch (e) { next(e); }
});

router.post('/invite', requirePermission('users.invite'), async (req, res, next) => {
  try {
    const { email, roleIds } = req.body;
    const ids = Array.isArray(roleIds) ? roleIds : roleIds ? [roleIds] : [];
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const inv = await Invitation.create({
      accountId: req.account._id,
      email: String(email).toLowerCase().trim(),
      roleIds: ids,
      token,
      expiresAt,
      invitedBy: req.user._id,
    });
    const url = `${config.baseUrl}/auth/accept-invite?token=${token}`;
    await send({ to: inv.email, subject: `You're invited to ${req.account.name}`, html: `<p>Join ${req.account.name}: <a href="${url}">${url}</a></p>` });
    await audit.record({ ...audit.fromReq(req), action: 'user.invite', entity: 'Invitation', entityId: inv._id, metadata: { email: inv.email } });
    res.redirect('/users');
  } catch (e) { next(e); }
});

router.post('/invitations/:id/revoke', requirePermission('users.invite'), async (req, res, next) => {
  try {
    const inv = await Invitation.findOneAndUpdate({ _id: req.params.id, accountId: req.account._id }, { status: 'revoked' });
    if (inv) await audit.record({ ...audit.fromReq(req), action: 'user.invite.revoke', entity: 'Invitation', entityId: inv._id });
    res.redirect('/users');
  } catch (e) { next(e); }
});

router.post('/:id/roles', requirePermission('users.update'), async (req, res, next) => {
  try {
    const { roleIds } = req.body;
    const ids = Array.isArray(roleIds) ? roleIds : roleIds ? [roleIds] : [];
    const m = await Membership.findOneAndUpdate({ _id: req.params.id, accountId: req.account._id }, { roleIds: ids });
    if (m) await audit.record({ ...audit.fromReq(req), action: 'user.roles.update', entity: 'Membership', entityId: m._id, metadata: { roleIds: ids } });
    res.redirect('/users');
  } catch (e) { next(e); }
});

router.post('/:id/disable', requirePermission('users.remove'), async (req, res, next) => {
  try {
    const m = await Membership.findOneAndUpdate({ _id: req.params.id, accountId: req.account._id }, { status: 'disabled' });
    if (m) await audit.record({ ...audit.fromReq(req), action: 'user.disable', entity: 'Membership', entityId: m._id });
    res.redirect('/users');
  } catch (e) { next(e); }
});

router.post('/:id/enable', requirePermission('users.update'), async (req, res, next) => {
  try {
    const m = await Membership.findOneAndUpdate({ _id: req.params.id, accountId: req.account._id }, { status: 'active' });
    if (m) await audit.record({ ...audit.fromReq(req), action: 'user.enable', entity: 'Membership', entityId: m._id });
    res.redirect('/users');
  } catch (e) { next(e); }
});

module.exports = router;
