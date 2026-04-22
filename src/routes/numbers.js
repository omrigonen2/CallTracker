'use strict';

const express = require('express');
const PhoneNumber = require('../models/PhoneNumber');
const Campaign = require('../models/Campaign');
const ProviderCredential = require('../models/ProviderCredential');
const providers = require('../services/providers');
const { requirePermission } = require('../middleware/rbac');
const audit = require('../services/audit');
const config = require('../config');
const countries = require('../utils/countries');

const NUMBER_TYPES = ['local', 'tollFree', 'mobile'];
const LIMIT_OPTIONS = [10, 20, 50];

const router = express.Router();

router.get('/', requirePermission('number.read'), async (req, res, next) => {
  try {
    const numbers = await PhoneNumber.find({}).populate('campaignId', 'name').sort({ createdAt: -1 }).lean();
    const campaigns = await Campaign.find({}, 'name').lean();
    res.render('numbers/list', { numbers, campaigns });
  } catch (e) { next(e); }
});

router.get('/buy', requirePermission('number.purchase'), async (req, res, next) => {
  try {
    const activeProviders = await ProviderCredential.distinct('provider');
    const campaigns = await Campaign.find({}, 'name').lean();
    const accountDefaultCountry = (req.account && req.account.defaultCountry) || 'US';
    const provider = req.query.provider || activeProviders[0] || '';
    const rawCountry = (req.query.countryCode || accountDefaultCountry).toUpperCase();
    const countryCode = countries.isValidIso(rawCountry) ? rawCountry : accountDefaultCountry;
    const areaCode = String(req.query.areaCode || '').replace(/[^0-9]/g, '').slice(0, 5);
    const contains = String(req.query.contains || '').replace(/[^0-9]/g, '').slice(0, 10);
    const numberType = NUMBER_TYPES.includes(req.query.numberType) ? req.query.numberType : 'local';
    const limit = LIMIT_OPTIONS.includes(parseInt(req.query.limit, 10)) ? parseInt(req.query.limit, 10) : 20;
    let available = [];
    let error = null;
    if (provider && req.query.search) {
      try {
        available = await providers.get(provider).listAvailableNumbers({ countryCode, areaCode, contains, numberType, limit });
      } catch (e) {
        error = e.message;
      }
    }
    res.render('numbers/buy', {
      activeProviders, available, campaigns,
      provider, areaCode, countryCode, contains, numberType, limit, error,
    });
  } catch (e) { next(e); }
});

router.post('/buy', requirePermission('number.purchase'), async (req, res, next) => {
  try {
    const { provider, phoneNumber, campaignId } = req.body;
    const adapter = providers.get(provider);
    const voiceUrl = `${config.baseUrl}/webhooks/${provider}/voice`;
    const statusCallback = `${config.baseUrl}/webhooks/${provider}/status`;
    const { credentialId, providerNumberId, phoneNumber: pn } = await adapter.buyNumber({ phoneNumber, voiceUrl, statusCallback });
    const doc = await PhoneNumber.create({
      campaignId: campaignId || null,
      provider,
      providerCredentialId: credentialId,
      providerNumberId,
      phoneNumber: pn,
      friendlyName: pn,
    });
    await audit.record({ ...audit.fromReq(req), action: 'number.purchase', entity: 'PhoneNumber', entityId: doc._id, metadata: { phoneNumber: pn } });
    res.redirect('/numbers');
  } catch (e) { next(e); }
});

router.post('/:id/assign', requirePermission('number.assign'), async (req, res, next) => {
  try {
    const { campaignId } = req.body;
    // Phone input either arrives split (preferred) or as a single E.164 string for back-compat.
    const forwardingOverride = req.body.forwardingOverride_national != null
      ? countries.joinE164(req.body.forwardingOverride_dial, req.body.forwardingOverride_national)
      : (req.body.forwardingOverride || '');
    const n = await PhoneNumber.findOneAndUpdate(
      { _id: req.params.id },
      { campaignId: campaignId || null, forwardingOverride }
    );
    if (n) await audit.record({ ...audit.fromReq(req), action: 'number.assign', entity: 'PhoneNumber', entityId: n._id });
    res.redirect('/numbers');
  } catch (e) { next(e); }
});

router.post('/:id/release', requirePermission('number.release'), async (req, res, next) => {
  try {
    const n = await PhoneNumber.findOne({ _id: req.params.id });
    if (!n) return res.redirect('/numbers');
    try {
      await providers.get(n.provider).releaseNumber({ providerNumberId: n.providerNumberId, credentialId: n.providerCredentialId });
    } catch (e) {
      // continue marking as released even if remote delete fails (number might already be gone)
    }
    n.status = 'released';
    await n.save();
    await audit.record({ ...audit.fromReq(req), action: 'number.release', entity: 'PhoneNumber', entityId: n._id });
    res.redirect('/numbers');
  } catch (e) { next(e); }
});

module.exports = router;
