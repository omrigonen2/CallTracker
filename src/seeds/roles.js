'use strict';

const Role = require('../models/Role');
const { SYSTEM_ROLES } = require('../services/permissions');
const log = require('../utils/logger');

async function seedSystemRoles() {
  for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
    const existing = await Role.findOne({ key, accountId: null, isSystem: true });
    if (existing) {
      existing.permissions = def.permissions;
      existing.name = def.name;
      await existing.save();
      log.info({ key }, 'system role updated');
    } else {
      await Role.create({ key, name: def.name, permissions: def.permissions, isSystem: true, accountId: null });
      log.info({ key }, 'system role created');
    }
  }
}

module.exports = { seedSystemRoles };
