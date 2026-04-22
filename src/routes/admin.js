'use strict';

const express = require('express');
const Account = require('../models/Account');
const User = require('../models/User');
const Membership = require('../models/Membership');
const PhoneNumber = require('../models/PhoneNumber');
const Call = require('../models/Call');
const ProviderCredential = require('../models/ProviderCredential');
const AuditLog = require('../models/AuditLog');
const LedgerEntry = require('../models/LedgerEntry');
const credentialStore = require('../services/credentialStore');
const audit = require('../services/audit');
const billing = require('../services/billing');
const SystemSetting = require('../models/SystemSetting');
const systemSettings = require('../services/systemSettings');
const cryptoBox = require('../config/crypto');
const countries = require('../utils/countries');
const ctx = require('../utils/asyncContext');
const { requireSuperAdmin, signSession, setSessionCookie } = require('../middleware/auth');

const PLAN_OPTIONS = ['free', 'starter', 'pro', 'enterprise'];
const MARGIN_KINDS = ['numberPurchase', 'numberMonthly', 'callPerMinute'];
const MARGIN_MODES = ['percent', 'fixed'];

function safePlan(v) { return PLAN_OPTIONS.includes(v) ? v : 'free'; }
function safeCountry(v) { return countries.isValidIso(v) ? String(v).toUpperCase() : 'US'; }
function safeMarginMode(v) { return MARGIN_MODES.includes(v) ? v : 'percent'; }
function safeMarginValue(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

const router = express.Router();

router.use(requireSuperAdmin);

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'account';
}

async function uniqueSlug(base) {
  let slug = slugify(base);
  let i = 0;
  while (await Account.findOne({ slug })) {
    i += 1;
    slug = `${slugify(base)}-${i}`;
  }
  return slug;
}

function parseLimits(body) {
  const n = (v, d) => {
    const x = parseInt(v, 10);
    return Number.isFinite(x) && x >= 0 ? x : d;
  };
  return {
    numbers: n(body['limits.numbers'], 100),
    users: n(body['limits.users'], 25),
    callsPerMonth: n(body['limits.callsPerMonth'], 100000),
  };
}

function parseMarginsFromBody(body, prefix) {
  const out = {};
  for (const kind of MARGIN_KINDS) {
    out[kind] = {
      mode: safeMarginMode(body[`${prefix}.${kind}.mode`]),
      value: safeMarginValue(body[`${prefix}.${kind}.value`]),
    };
  }
  return out;
}

function parseMarginOverrideFromBody(body, prefix) {
  const out = {};
  for (const kind of MARGIN_KINDS) {
    out[kind] = {
      enabled: body[`${prefix}.${kind}.enabled`] === 'on',
      mode: safeMarginMode(body[`${prefix}.${kind}.mode`]),
      value: safeMarginValue(body[`${prefix}.${kind}.value`]),
    };
  }
  return out;
}

router.get('/', async (req, res, next) => {
  try {
    const [accounts, users, numbers, calls24h, recentActivity, providerHealth] = await Promise.all([
      Account.countDocuments({}),
      User.countDocuments({}),
      PhoneNumber.countDocuments({ status: 'active' }),
      Call.countDocuments({ createdAt: { $gte: new Date(Date.now() - 86400000) } }),
      AuditLog.find({}).sort({ createdAt: -1 }).limit(10).populate('actorId', 'email name').populate('accountId', 'name slug').lean(),
      credentialStore.listSafe().catch(() => []),
    ]);
    res.render('admin/dashboard', {
      stats: { accounts, users, numbers, calls24h },
      recentActivity,
      providerHealth,
    });
  } catch (e) { next(e); }
});

router.get('/accounts', async (req, res, next) => {
  try {
    const accountList = await Account.find({}).sort({ createdAt: -1 }).lean();
    res.render('admin/accounts', { accountList });
  } catch (e) { next(e); }
});

router.get('/accounts/new', async (req, res, next) => {
  try {
    const credentials = await ProviderCredential.find({}, 'provider label isDefault').sort({ createdAt: -1 }).lean();
    res.render('admin/account-edit', { account: null, error: null, credentials });
  } catch (e) { next(e); }
});

router.post('/accounts', async (req, res, next) => {
  try {
    const { name, defaultLocale, timezone, plan, defaultCountry } = req.body;
    if (!name || !String(name).trim()) {
      const credentials = await ProviderCredential.find({}, 'provider label isDefault').sort({ createdAt: -1 }).lean();
      return res.status(400).render('admin/account-edit', { account: null, error: 'name_required', credentials });
    }
    const slug = await uniqueSlug(name);
    const providersBody = {
      primaryCredentialId: req.body['providers.primaryCredentialId'] || null,
      fallbackCredentialId: req.body['providers.fallbackCredentialId'] || null,
      marginOverride: parseMarginOverrideFromBody(req.body, 'providers.marginOverride'),
    };
    const doc = await Account.create({
      name: String(name).trim(),
      slug,
      defaultLocale: defaultLocale === 'he' ? 'he' : 'en',
      timezone: timezone || 'UTC',
      defaultCountry: safeCountry(defaultCountry),
      plan: safePlan(plan),
      limits: parseLimits(req.body),
      providers: providersBody,
    });
    await audit.record({ ...audit.fromReq(req), action: 'admin.account.create', entity: 'Account', entityId: doc._id, metadata: { name: doc.name, slug: doc.slug } });
    res.redirect(`/admin/accounts/${doc._id}`);
  } catch (e) { next(e); }
});

router.get('/accounts/:id', async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id).lean();
    if (!account) return res.status(404).render('errors/404');
    const memberships = await Membership.find({ accountId: account._id }).populate('userId', 'email name').populate('roleIds', 'name').lean();
    const numbers = await PhoneNumber.find({ accountId: account._id }).lean();
    const callsCount = await Call.countDocuments({ accountId: account._id });
    const balance = Number(account.credits) || 0;
    const recentLedger = await LedgerEntry.find({ accountId: account._id }).sort({ createdAt: -1 }).limit(10).lean();
    res.render('admin/account-detail', { account, memberships, numbers, callsCount, balance, recentLedger });
  } catch (e) { next(e); }
});

router.get('/accounts/:id/edit', async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id).lean();
    if (!account) return res.status(404).render('errors/404');
    const credentials = await ProviderCredential.find({}, 'provider label isDefault').sort({ createdAt: -1 }).lean();
    res.render('admin/account-edit', { account, error: null, credentials });
  } catch (e) { next(e); }
});

router.post('/accounts/:id', async (req, res, next) => {
  try {
    const a = await Account.findById(req.params.id);
    if (!a) return res.status(404).render('errors/404');
    const { name, defaultLocale, timezone, plan, defaultCountry } = req.body;
    if (!name || !String(name).trim()) {
      const credentials = await ProviderCredential.find({}, 'provider label isDefault').sort({ createdAt: -1 }).lean();
      return res.status(400).render('admin/account-edit', { account: a.toObject(), error: 'name_required', credentials });
    }
    a.name = String(name).trim();
    a.defaultLocale = defaultLocale === 'he' ? 'he' : 'en';
    a.timezone = timezone || 'UTC';
    a.defaultCountry = safeCountry(defaultCountry || a.defaultCountry);
    a.plan = safePlan(plan || a.plan);
    a.limits = parseLimits(req.body);
    a.providers = a.providers || {};
    a.providers.primaryCredentialId = req.body['providers.primaryCredentialId'] || null;
    a.providers.fallbackCredentialId = req.body['providers.fallbackCredentialId'] || null;
    a.providers.marginOverride = parseMarginOverrideFromBody(req.body, 'providers.marginOverride');
    a.markModified('providers');
    await a.save();
    await audit.record({ ...audit.fromReq(req), action: 'admin.account.update', entity: 'Account', entityId: a._id, metadata: { name: a.name } });
    res.redirect(`/admin/accounts/${a._id}`);
  } catch (e) { next(e); }
});

router.post('/accounts/:id/credits/adjust', async (req, res, next) => {
  try {
    const a = await Account.findById(req.params.id);
    if (!a) return res.status(404).render('errors/404');
    const amount = parseInt(req.body.amount, 10);
    const note = String(req.body.note || '').slice(0, 200);
    if (!Number.isFinite(amount) || amount === 0) {
      return res.redirect(`/admin/accounts/${a._id}`);
    }
    const op = amount > 0 ? billing.credit : billing.debit;
    const fnArgs = [a._id, Math.abs(amount), {
      kind: 'adjustment',
      ref: {},
      metadata: { note },
      createdBy: req.user._id,
    }];
    try {
      await op.apply(null, fnArgs);
    } catch (err) {
      if (err && err.code === 'INSUFFICIENT_CREDITS') {
        return res.redirect(`/admin/accounts/${a._id}`);
      }
      throw err;
    }
    await audit.record({
      ...audit.fromReq(req),
      accountId: a._id,
      action: 'admin.account.credits.adjust',
      entity: 'Account',
      entityId: a._id,
      metadata: { amount, note },
    });
    res.redirect(`/admin/accounts/${a._id}`);
  } catch (e) { next(e); }
});

router.get('/accounts/:id/ledger', async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id).lean();
    if (!account) return res.status(404).render('errors/404');
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const entries = await LedgerEntry.find({ accountId: account._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('createdBy', 'email name')
      .lean();
    res.render('admin/account-ledger', { account, entries, balance: Number(account.credits) || 0 });
  } catch (e) { next(e); }
});

router.post('/accounts/:id/delete', async (req, res, next) => {
  try {
    const a = await Account.findById(req.params.id);
    if (!a) return res.status(404).render('errors/404');
    if (a.status === 'deleted') return res.redirect(`/admin/accounts/${a._id}`);
    a.status = 'deleted';
    await a.save();
    await audit.record({ ...audit.fromReq(req), action: 'admin.account.delete', entity: 'Account', entityId: a._id, metadata: { name: a.name, slug: a.slug } });
    res.redirect('/admin/accounts');
  } catch (e) { next(e); }
});

router.post('/accounts/:id/use', async (req, res, next) => {
  try {
    const a = await Account.findById(req.params.id).lean();
    if (!a || a.status === 'deleted') return res.status(404).render('errors/404');
    const token = signSession({ userId: req.user._id, accountId: a._id, impersonate: true });
    setSessionCookie(res, token);
    await audit.record({
      ...audit.fromReq(req),
      accountId: a._id,
      action: 'admin.account.impersonate.start',
      entity: 'Account',
      entityId: a._id,
      metadata: { name: a.name, slug: a.slug },
    });
    res.redirect('/');
  } catch (e) { next(e); }
});

router.post('/accounts/:id/suspend', async (req, res, next) => {
  try {
    const a = await Account.findById(req.params.id);
    if (!a) return res.status(404).end();
    a.status = a.status === 'suspended' ? 'active' : 'suspended';
    await a.save();
    await audit.record({ ...audit.fromReq(req), action: a.status === 'suspended' ? 'admin.account.suspend' : 'admin.account.unsuspend', entity: 'Account', entityId: a._id });
    res.redirect(`/admin/accounts/${a._id}`);
  } catch (e) { next(e); }
});

router.get('/providers', async (req, res, next) => {
  try {
    const creds = await credentialStore.listSafe();
    res.render('admin/providers', { creds, error: null });
  } catch (e) { next(e); }
});

router.get('/providers/new', (req, res) => res.render('admin/provider-edit', { cred: null, error: null }));

router.post('/providers', async (req, res, next) => {
  try {
    const { provider, label, isDefault, accountSid, authToken, apiKey, apiSecret, signingSecret } = req.body;
    const credentials = { accountSid, authToken };
    if (apiKey) credentials.apiKey = apiKey;
    if (apiSecret) credentials.apiSecret = apiSecret;
    if (signingSecret) credentials.signingSecret = signingSecret;
    const doc = await credentialStore.create({
      provider,
      label,
      credentials,
      isDefault: isDefault === 'on',
      createdBy: req.user._id,
    });
    const margins = parseMarginsFromBody(req.body, 'margins');
    doc.margins = margins;
    doc.markModified('margins');
    await doc.save();
    await audit.record({ ...audit.fromReq(req), action: 'admin.provider.create', entity: 'ProviderCredential', entityId: doc._id, metadata: { provider, label } });
    res.redirect('/admin/providers');
  } catch (e) { next(e); }
});

router.get('/providers/:id/edit', async (req, res, next) => {
  try {
    const doc = await ProviderCredential.findById(req.params.id).lean();
    if (!doc) return res.status(404).render('errors/404');
    res.render('admin/provider-edit', {
      cred: {
        _id: doc._id,
        provider: doc.provider,
        label: doc.label,
        isDefault: doc.isDefault,
        margins: doc.margins || {},
      },
      error: null,
    });
  } catch (e) { next(e); }
});

router.post('/providers/:id', async (req, res, next) => {
  try {
    const { label, isDefault, accountSid, authToken, apiKey, apiSecret, signingSecret } = req.body;
    let credentials = null;
    if (accountSid && authToken) {
      credentials = { accountSid, authToken };
      if (apiKey) credentials.apiKey = apiKey;
      if (apiSecret) credentials.apiSecret = apiSecret;
      if (signingSecret) credentials.signingSecret = signingSecret;
    }
    const doc = await credentialStore.update(req.params.id, { label, credentials, isDefault: isDefault === 'on' });
    doc.margins = parseMarginsFromBody(req.body, 'margins');
    doc.markModified('margins');
    await doc.save();
    await audit.record({ ...audit.fromReq(req), action: credentials ? 'admin.provider.rotate' : 'admin.provider.update', entity: 'ProviderCredential', entityId: doc._id });
    res.redirect('/admin/providers');
  } catch (e) { next(e); }
});

router.post('/providers/:id/delete', async (req, res, next) => {
  try {
    const inUse = await PhoneNumber.countDocuments({ providerCredentialId: req.params.id });
    if (inUse > 0) {
      const creds = await credentialStore.listSafe();
      return res.status(400).render('admin/providers', { creds, error: 'in_use' });
    }
    await credentialStore.remove(req.params.id);
    await audit.record({ ...audit.fromReq(req), action: 'admin.provider.delete', entity: 'ProviderCredential', entityId: req.params.id });
    res.redirect('/admin/providers');
  } catch (e) { next(e); }
});

router.get('/users', async (req, res, next) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 }).lean();
    const ids = users.map((u) => u._id);
    const memberships = await Membership.find({ userId: { $in: ids } }).populate('accountId', 'name slug').lean();
    const byUser = new Map();
    memberships.forEach((m) => {
      if (!byUser.has(String(m.userId))) byUser.set(String(m.userId), []);
      byUser.get(String(m.userId)).push(m);
    });
    const rows = users.map((u) => ({ ...u, memberships: byUser.get(String(u._id)) || [] }));
    res.render('admin/users', { rows, error: null });
  } catch (e) { next(e); }
});

router.post('/users/:id/promote', async (req, res, next) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).end();
    u.isSuperAdmin = true;
    await u.save();
    await audit.record({ ...audit.fromReq(req), action: 'admin.user.promote', entity: 'User', entityId: u._id, metadata: { email: u.email } });
    res.redirect('/admin/users');
  } catch (e) { next(e); }
});

router.post('/users/:id/demote', async (req, res, next) => {
  try {
    if (String(req.user._id) === String(req.params.id)) {
      const users = await User.find({}).sort({ createdAt: -1 }).lean();
      return res.status(400).render('admin/users', { rows: users.map((u) => ({ ...u, memberships: [] })), error: 'self_demote' });
    }
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).end();
    u.isSuperAdmin = false;
    await u.save();
    await audit.record({ ...audit.fromReq(req), action: 'admin.user.demote', entity: 'User', entityId: u._id, metadata: { email: u.email } });
    res.redirect('/admin/users');
  } catch (e) { next(e); }
});

router.get('/settings', async (req, res, next) => {
  try {
    const doc = await SystemSetting.getOrCreate();
    res.render('admin/settings', {
      settings: doc.toObject ? doc.toObject() : doc,
      error: null,
      saved: req.query.saved === '1',
    });
  } catch (e) { next(e); }
});

function maskApiKey(key) {
  const s = String(key || '');
  if (s.length <= 7) return '***';
  return `${s.slice(0, 3)}***${s.slice(-4)}`;
}

// Accepts either "user@domain" or "Display Name <user@domain>".
function isValidFromEmail(s) {
  const v = String(s || '').trim();
  if (!v) return true; // empty allowed (cleared)
  if (/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v)) return true;
  if (/^[^<>]+<\s*[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+\s*>$/.test(v)) return true;
  return false;
}

router.post('/settings', async (req, res, next) => {
  try {
    const raw = req.body['billing.creditUsdRate'];
    const rate = parseFloat(raw);
    const fromEmail = String(req.body['mail.fromEmail'] || '').trim();
    const replyTo = String(req.body['mail.replyTo'] || '').trim();
    const newApiKey = String(req.body['mail.apiKey'] || '').trim();

    async function renderError(code) {
      const doc = await SystemSetting.getOrCreate();
      const obj = doc.toObject ? doc.toObject() : doc;
      obj.billing = obj.billing || {};
      obj.billing.creditUsdRate = raw;
      obj.mail = obj.mail || {};
      obj.mail.fromEmail = fromEmail;
      obj.mail.replyTo = replyTo;
      return res.status(400).render('admin/settings', {
        settings: obj,
        error: code,
        saved: false,
      });
    }

    if (!Number.isFinite(rate) || rate < 0.000001) {
      return renderError('invalid_credit_usd_rate');
    }
    if (!isValidFromEmail(fromEmail)) {
      return renderError('invalid_from_email');
    }
    if (replyTo && !isValidFromEmail(replyTo)) {
      return renderError('invalid_from_email');
    }

    const set = {
      'billing.creditUsdRate': rate,
      'mail.fromEmail': fromEmail,
      'mail.replyTo': replyTo,
    };
    if (newApiKey) {
      set['mail.apiKeyEncrypted'] = cryptoBox.encrypt({ key: newApiKey });
      set['mail.apiKeyMask'] = maskApiKey(newApiKey);
    }

    await SystemSetting.findOneAndUpdate(
      { key: 'global' },
      { $set: set },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    systemSettings.invalidate();
    await audit.record({
      ...audit.fromReq(req),
      action: 'admin.settings.update',
      entity: 'SystemSetting',
      metadata: {
        creditUsdRate: rate,
        mail: {
          fromEmail,
          replyTo,
          apiKeyChanged: Boolean(newApiKey),
        },
      },
    });
    res.redirect('/admin/settings?saved=1');
  } catch (e) { next(e); }
});

router.get('/audit', async (req, res, next) => {
  try {
    const logs = await AuditLog.find({}).sort({ createdAt: -1 }).limit(500).populate('actorId', 'email name').populate('accountId', 'name slug').lean();
    res.render('admin/audit', { logs });
  } catch (e) { next(e); }
});

module.exports = router;
