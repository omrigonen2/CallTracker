'use strict';

const Membership = require('../models/Membership');
const Role = require('../models/Role');

/**
 * Resolves the union of permissions a user has within a given account.
 * Super-admins always have all permissions.
 */
async function resolvePermissions({ user, accountId }) {
  if (user && user.isSuperAdmin) {
    const { ALL } = require('./permissions');
    return new Set(ALL);
  }
  if (!user || !accountId) return new Set();

  const membership = await Membership.findOne({
    userId: user._id,
    accountId,
    status: 'active',
  }).lean();
  if (!membership || !membership.roleIds || membership.roleIds.length === 0) return new Set();

  const roles = await Role.find({ _id: { $in: membership.roleIds } }).lean();
  const set = new Set();
  for (const r of roles) for (const p of r.permissions || []) set.add(p);
  return set;
}

function has(permissions, key) {
  if (Array.isArray(permissions)) return permissions.includes(key);
  return permissions.has(key);
}

module.exports = { resolvePermissions, has };
