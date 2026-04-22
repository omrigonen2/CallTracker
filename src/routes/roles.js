'use strict';

const express = require('express');
const Role = require('../models/Role');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS, ALL } = require('../services/permissions');
const audit = require('../services/audit');

const router = express.Router();

router.get('/', requirePermission('roles.read'), async (req, res, next) => {
  try {
    const roles = await Role.find({ $or: [{ accountId: req.account._id }, { accountId: null, isSystem: true, key: { $ne: 'super_admin' } }] }).lean();
    res.render('roles/list', { roles });
  } catch (e) { next(e); }
});

router.get('/new', requirePermission('roles.manage'), (req, res) => {
  res.render('roles/edit', { role: null, groups: PERMISSIONS, all: ALL, error: null });
});

router.get('/:id/edit', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const role = await Role.findOne({ _id: req.params.id });
    if (!role) return res.status(404).render('errors/404');
    if (role.accountId && String(role.accountId) !== String(req.account._id)) return res.status(403).render('errors/403');
    res.render('roles/edit', { role, groups: PERMISSIONS, all: ALL, error: role.isSystem ? 'system_role_readonly' : null });
  } catch (e) { next(e); }
});

router.post('/', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const { name, key, permissions } = req.body;
    const perms = (Array.isArray(permissions) ? permissions : [permissions]).filter(Boolean).filter((p) => ALL.includes(p));
    const role = await Role.create({
      accountId: req.account._id,
      name,
      key: String(key || name).toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
      permissions: perms,
      isSystem: false,
    });
    await audit.record({ ...audit.fromReq(req), action: 'role.create', entity: 'Role', entityId: role._id });
    res.redirect('/roles');
  } catch (e) { next(e); }
});

router.post('/:id', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const role = await Role.findOne({ _id: req.params.id, accountId: req.account._id });
    if (!role) return res.status(404).render('errors/404');
    if (role.isSystem) return res.status(400).render('errors/403', { reason: 'system_role_readonly' });
    const { name, permissions } = req.body;
    const perms = (Array.isArray(permissions) ? permissions : [permissions]).filter(Boolean).filter((p) => ALL.includes(p));
    role.name = name;
    role.permissions = perms;
    await role.save();
    await audit.record({ ...audit.fromReq(req), action: 'role.update', entity: 'Role', entityId: role._id });
    res.redirect('/roles');
  } catch (e) { next(e); }
});

router.post('/:id/delete', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const role = await Role.findOne({ _id: req.params.id, accountId: req.account._id });
    if (!role || role.isSystem) return res.redirect('/roles');
    await role.deleteOne();
    await audit.record({ ...audit.fromReq(req), action: 'role.delete', entity: 'Role', entityId: role._id });
    res.redirect('/roles');
  } catch (e) { next(e); }
});

module.exports = router;
