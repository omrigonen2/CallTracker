'use strict';

const AuditLog = require('../models/AuditLog');
const log = require('../utils/logger');

async function record({ accountId = null, actorId = null, action, entity, entityId = null, metadata = {}, ip = '', userAgent = '' }) {
  try {
    await AuditLog.create({ accountId, actorId, action, entity, entityId, metadata, ip, userAgent });
  } catch (e) {
    log.error({ err: e.message, action }, 'audit log failed');
  }
}

function fromReq(req) {
  return {
    actorId: req.user ? req.user._id : null,
    accountId: req.account ? req.account._id : null,
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
  };
}

module.exports = { record, fromReq };
