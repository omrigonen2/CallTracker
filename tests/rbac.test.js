'use strict';

const test = require('node:test');
const assert = require('node:assert');

test('permission catalog loads and contains expected keys', () => {
  const { PERMISSIONS, ALL, SYSTEM_ROLES } = require('../src/services/permissions');
  assert.ok(ALL.includes('campaign.write'));
  assert.ok(ALL.includes('admin.providers.manage'));
  assert.ok(SYSTEM_ROLES.super_admin.permissions.length === ALL.length, 'super_admin has all permissions');
  assert.ok(!SYSTEM_ROLES.viewer.permissions.includes('campaign.write'), 'viewer cannot write campaigns');
  assert.ok(!SYSTEM_ROLES.member.permissions.includes('admin.providers.manage'), 'member cannot manage providers');
});

test('rbac.has() works for arrays and Sets', () => {
  const { has } = require('../src/services/rbac');
  assert.strictEqual(has(['a', 'b'], 'a'), true);
  assert.strictEqual(has(new Set(['a', 'b']), 'c'), false);
});
