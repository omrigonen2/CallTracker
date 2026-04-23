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
const log = require('../utils/logger');
const billing = require('../services/billing');
const providerSelector = require('../services/providerSelector');
const pricing = require('../services/pricing');

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

async function _resolveSelection(accountId) {
  try {
    const sel = await providerSelector.getForAccount(accountId);
    return { sel, error: null };
  } catch (e) {
    return { sel: null, error: e.code === 'NO_PRIMARY_PROVIDER' ? 'no_primary_provider' : e.message };
  }
}

async function _priceCredits({ sel, accountId, countryCode, numberType }) {
  try {
    const usd = await pricing.getNumberMonthlyPriceUsd({
      provider: sel.primary.provider,
      credentialId: sel.primary._id,
      countryCode,
      numberType,
    });
    const purchaseQuote = await billing.computeCredits({
      providerCredentialId: sel.primary._id,
      accountId,
      kind: 'numberPurchase',
      providerCostUsd: usd,
    });
    const monthlyQuote = await billing.computeCredits({
      providerCredentialId: sel.primary._id,
      accountId,
      kind: 'numberMonthly',
      providerCostUsd: usd,
    });
    return {
      priceCredits: purchaseQuote.credits,
      monthlyCredits: monthlyQuote.credits,
      providerCostUsd: usd,
      priceError: null,
    };
  } catch (e) {
    log.warn({ err: e.message }, 'priceCredits failed');
    return { priceCredits: null, monthlyCredits: null, providerCostUsd: null, priceError: e.message };
  }
}

router.get('/buy', requirePermission('number.purchase'), async (req, res, next) => {
  try {
    const credCount = await ProviderCredential.countDocuments({});
    const campaigns = await Campaign.find({}, 'name').lean();
    const accountDefaultCountry = (req.account && req.account.defaultCountry) || 'US';

    const rawCountry = (req.query.countryCode || accountDefaultCountry).toUpperCase();
    const countryCode = countries.isValidIso(rawCountry) ? rawCountry : accountDefaultCountry;
    const areaCode = String(req.query.areaCode || '').replace(/[^0-9]/g, '').slice(0, 5);
    const contains = String(req.query.contains || '').replace(/[^0-9]/g, '').slice(0, 10);
    const numberType = NUMBER_TYPES.includes(req.query.numberType) ? req.query.numberType : 'local';
    const limit = LIMIT_OPTIONS.includes(parseInt(req.query.limit, 10)) ? parseInt(req.query.limit, 10) : 20;

    const { sel, error: selError } = credCount > 0
      ? await _resolveSelection(req.account._id)
      : { sel: null, error: null };

    let available = [];
    let error = selError;
    let priceCredits = null;
    let monthlyCredits = null;
    let providerCostUsd = null;
    let priceError = null;
    const balance = await billing.getBalance(req.account._id);

    if (sel) {
      const priced = await _priceCredits({ sel, accountId: req.account._id, countryCode, numberType });
      priceCredits = priced.priceCredits;
      monthlyCredits = priced.monthlyCredits;
      providerCostUsd = priced.providerCostUsd;
      priceError = priced.priceError;

      if (req.query.search) {
        try {
          available = await providers.get(sel.primary.provider).listAvailableNumbers({
            credentialId: sel.primary._id,
            countryCode, areaCode, contains, numberType, limit,
          });
        } catch (e) {
          log.warn({ err: e.message }, 'primary listAvailableNumbers failed');
          if (sel.fallback) {
            try {
              available = await providers.get(sel.fallback.provider).listAvailableNumbers({
                credentialId: sel.fallback._id,
                countryCode, areaCode, contains, numberType, limit,
              });
            } catch (e2) {
              error = e2.message;
            }
          } else {
            error = e.message;
          }
        }
      }
    }

    res.render('numbers/buy', {
      hasProvider: !!sel,
      campaigns,
      available,
      countryCode, areaCode, contains, numberType, limit,
      error,
      priceCredits, monthlyCredits, providerCostUsd, priceError,
      balance,
    });
  } catch (e) { next(e); }
});

router.post('/buy', requirePermission('number.purchase'), async (req, res, next) => {
  try {
    const { phoneNumber, campaignId } = req.body;
    if (!phoneNumber) {
      res.flash('error', 'Phone number is required.');
      return res.redirect('/numbers/buy');
    }

    const sel = await providerSelector.getForAccount(req.account._id);

    const accountDefaultCountry = (req.account && req.account.defaultCountry) || 'US';
    const rawCountry = String(req.body.countryCode || accountDefaultCountry).toUpperCase();
    const countryCode = countries.isValidIso(rawCountry) ? rawCountry : accountDefaultCountry;
    const numberType = NUMBER_TYPES.includes(req.body.numberType) ? req.body.numberType : 'local';

    let priceUsd = 0;
    try {
      priceUsd = await pricing.getNumberMonthlyPriceUsd({
        provider: sel.primary.provider,
        credentialId: sel.primary._id,
        countryCode,
        numberType,
        phoneNumber,
      });
    } catch (e) {
      log.warn({ err: e.message }, 'pricing lookup failed; defaulting to 1.15 USD');
      priceUsd = 1.15;
    }

    const purchaseQuote = await billing.computeCredits({
      providerCredentialId: sel.primary._id,
      accountId: req.account._id,
      kind: 'numberPurchase',
      providerCostUsd: priceUsd,
    });
    const monthlyQuote = await billing.computeCredits({
      providerCredentialId: sel.primary._id,
      accountId: req.account._id,
      kind: 'numberMonthly',
      providerCostUsd: priceUsd,
    });

    const balance = await billing.getBalance(req.account._id);
    if (balance < purchaseQuote.credits) {
      res.flash('error', `Insufficient credits: need ${purchaseQuote.credits}, have ${balance}.`);
      return res.redirect('/numbers/buy');
    }

    const voiceUrlPrimary = `${config.baseUrl}/webhooks/${sel.primary.provider}/voice`;
    const statusCallbackPrimary = `${config.baseUrl}/webhooks/${sel.primary.provider}/status`;

    let purchased = null;
    let usedCredentialId = null;
    let usedProviderName = null;
    let purchaseError = null;
    let usedFallback = false;

    try {
      purchased = await providers.get(sel.primary.provider).buyNumber({
        credentialId: sel.primary._id,
        phoneNumber,
        voiceUrl: voiceUrlPrimary,
        statusCallback: statusCallbackPrimary,
      });
      usedCredentialId = sel.primary._id;
      usedProviderName = sel.primary.provider;
    } catch (e) {
      log.warn({ err: e.message }, 'primary buyNumber failed');
      purchaseError = e.message;
      if (sel.fallback) {
        try {
          const fbVoiceUrl = `${config.baseUrl}/webhooks/${sel.fallback.provider}/voice`;
          const fbStatusCallback = `${config.baseUrl}/webhooks/${sel.fallback.provider}/status`;
          purchased = await providers.get(sel.fallback.provider).buyNumber({
            credentialId: sel.fallback._id,
            phoneNumber,
            voiceUrl: fbVoiceUrl,
            statusCallback: fbStatusCallback,
          });
          usedCredentialId = sel.fallback._id;
          usedProviderName = sel.fallback.provider;
          usedFallback = true;
          purchaseError = null;
        } catch (e2) {
          purchaseError = e2.message;
        }
      }
    }

    if (!purchased) {
      res.flash('error', `Unable to buy number: ${purchaseError || 'unknown error'}`);
      return res.redirect('/numbers/buy');
    }

    let doc;
    try {
      doc = await PhoneNumber.create({
        campaignId: campaignId || null,
        provider: usedProviderName,
        providerCredentialId: usedCredentialId,
        providerNumberId: purchased.providerNumberId,
        phoneNumber: purchased.phoneNumber,
        friendlyName: purchased.phoneNumber,
        countryCode,
        monthlyCostCredits: monthlyQuote.credits,
        purchasedCostCredits: purchaseQuote.credits,
        inboundPricePerMinUsd: (purchased && purchased.perMinutePriceUsd != null)
          ? Number(purchased.perMinutePriceUsd)
          : null,
      });
    } catch (e) {
      try {
        await providers.get(usedProviderName).releaseNumber({
          providerNumberId: purchased.providerNumberId,
          credentialId: usedCredentialId,
        });
      } catch (relErr) {
        log.warn({ err: relErr.message }, 'release after persistence failure also failed');
      }
      throw e;
    }

    try {
      await billing.debit(req.account._id, purchaseQuote.credits, {
        kind: 'number_purchase',
        ref: { phoneNumberId: doc._id, providerCredentialId: usedCredentialId },
        metadata: {
          providerCostUsd: priceUsd,
          marginMode: purchaseQuote.marginMode,
          marginValue: purchaseQuote.marginValue,
          country: countryCode,
        },
        createdBy: req.user ? req.user._id : null,
      });
    } catch (e) {
      log.warn({ err: e.message }, 'debit failed after purchase; releasing number');
      try {
        await providers.get(usedProviderName).releaseNumber({
          providerNumberId: purchased.providerNumberId,
          credentialId: usedCredentialId,
        });
      } catch (relErr) {
        log.warn({ err: relErr.message }, 'release after debit failure failed');
      }
      try { await PhoneNumber.deleteOne({ _id: doc._id }); } catch (delErr) { /* ignore */ }
      res.flash('error', `Insufficient credits: need ${purchaseQuote.credits}.`);
      return res.redirect('/numbers/buy');
    }

    await audit.record({
      ...audit.fromReq(req),
      action: 'number.purchase',
      entity: 'PhoneNumber',
      entityId: doc._id,
      metadata: {
        phoneNumber: purchased.phoneNumber,
        provider: usedProviderName,
        credentialId: String(usedCredentialId),
        chargedCredits: purchaseQuote.credits,
        usedFallback,
      },
    });
    res.redirect('/numbers');
  } catch (e) {
    if (e.code === 'NO_PRIMARY_PROVIDER') {
      res.flash('error', 'No primary provider configured for this account.');
      return res.redirect('/numbers/buy');
    }
    next(e);
  }
});

router.post('/:id/assign', requirePermission('number.assign'), async (req, res, next) => {
  try {
    const { campaignId } = req.body;
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
      // continue marking as released even if remote delete fails
    }
    n.status = 'released';
    await n.save();
    await audit.record({ ...audit.fromReq(req), action: 'number.release', entity: 'PhoneNumber', entityId: n._id });
    res.redirect('/numbers');
  } catch (e) { next(e); }
});

module.exports = router;
