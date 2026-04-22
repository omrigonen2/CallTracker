'use strict';

/**
 * Permission catalog. Permissions are flat strings of the form `resource.action`.
 * UI checks and route guards both use this catalog to gate access.
 */
const PERMISSIONS = {
  account: ['account.read', 'account.update'],
  users: ['users.read', 'users.invite', 'users.update', 'users.remove'],
  roles: ['roles.read', 'roles.manage'],
  campaign: ['campaign.read', 'campaign.write', 'campaign.delete'],
  number: ['number.read', 'number.purchase', 'number.assign', 'number.release'],
  call: ['call.read', 'call.tag', 'call.note', 'call.export'],
  postback: ['postback.read', 'postback.manage'],
  analytics: ['analytics.read'],
  billing: ['billing.read', 'billing.manage'],
  // super-admin only
  admin: ['admin.providers.manage', 'admin.accounts.manage', 'admin.audit.read', 'admin.impersonate'],
};

const ALL = Object.values(PERMISSIONS).flat();

const SYSTEM_ROLES = {
  super_admin: { name: 'Super Admin', permissions: ALL, isSystem: true, accountId: null },
  owner: {
    name: 'Owner',
    isSystem: true,
    accountId: null,
    permissions: [
      ...PERMISSIONS.account,
      ...PERMISSIONS.users,
      ...PERMISSIONS.roles,
      ...PERMISSIONS.campaign,
      ...PERMISSIONS.number,
      ...PERMISSIONS.call,
      ...PERMISSIONS.postback,
      ...PERMISSIONS.analytics,
      ...PERMISSIONS.billing,
    ],
  },
  admin: {
    name: 'Admin',
    isSystem: true,
    accountId: null,
    permissions: [
      'account.read',
      ...PERMISSIONS.users,
      ...PERMISSIONS.roles,
      ...PERMISSIONS.campaign,
      ...PERMISSIONS.number,
      ...PERMISSIONS.call,
      ...PERMISSIONS.postback,
      ...PERMISSIONS.analytics,
    ],
  },
  member: {
    name: 'Member',
    isSystem: true,
    accountId: null,
    permissions: [
      'account.read',
      'campaign.read',
      'campaign.write',
      'number.read',
      'number.assign',
      ...PERMISSIONS.call,
      'postback.read',
      'analytics.read',
    ],
  },
  viewer: {
    name: 'Viewer',
    isSystem: true,
    accountId: null,
    permissions: ['account.read', 'campaign.read', 'number.read', 'call.read', 'postback.read', 'analytics.read'],
  },
};

module.exports = { PERMISSIONS, ALL, SYSTEM_ROLES };
