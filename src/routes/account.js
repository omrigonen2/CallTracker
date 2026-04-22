'use strict';

const express = require('express');
const Account = require('../models/Account');
const { requirePermission } = require('../middleware/rbac');
const audit = require('../services/audit');
const countries = require('../utils/countries');

const router = express.Router();

router.get('/', requirePermission('account.read'), (req, res) => {
  res.render('account/settings', { error: null, success: null });
});

router.post('/', requirePermission('account.update'), async (req, res, next) => {
  try {
    const { name, defaultLocale, timezone, defaultCountry } = req.body;
    const a = await Account.findById(req.account._id);
    if (name) a.name = name;
    if (defaultLocale && ['en', 'he'].includes(defaultLocale)) a.defaultLocale = defaultLocale;
    if (timezone) a.timezone = timezone;
    if (defaultCountry && countries.isValidIso(defaultCountry)) a.defaultCountry = defaultCountry.toUpperCase();
    await a.save();
    await audit.record({ ...audit.fromReq(req), action: 'account.update', entity: 'Account', entityId: a._id, metadata: { name, defaultLocale, timezone, defaultCountry } });
    res.render('account/settings', { error: null, success: true, account: a });
  } catch (e) { next(e); }
});

module.exports = router;
