'use strict';

const express = require('express');
const Account = require('../models/Account');
const User = require('../models/User');
const Membership = require('../models/Membership');
const PhoneNumber = require('../models/PhoneNumber');
const Call = require('../models/Call');
const ProviderCredential = require('../models/ProviderCredential');
const AuditLog = require('../models/AuditLog');
const credentialStore = require('../services/credentialStore');
const audit = require('../services/audit');
const countries = require('../utils/countries');
const { requireSuperAdmin, signSession, setSessionCookie } = require('../middleware/auth');

const PLAN_OPTIONS = ['free', 'starter', 'pro', 'enterprise'];
function safePlan(v) { return PLAN_OPTIONS.includes(v) ? v : 'free'; }
function safeCountry(v) { return countries.isValidIso(v) ? String(v).toUpperCase() : 'US'; }

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

router.get('/accounts/new', (req, res) => {
  res.render('admin/account-edit', { account: null, error: null });
});

router.post('/accounts', async (req, res, next) => {
  try {
    const { name, defaultLocale, timezone, plan, defaultCountry } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).render('admin/account-edit', { account: null, error: 'name_required' });
    }
    const slug = await uniqueSlug(name);
    const doc = await Account.create({
      name: String(name).trim(),
      slug,
      defaultLocale: defaultLocale === 'he' ? 'he' : 'en',
      timezone: timezone || 'UTC',
      defaultCountry: safeCountry(defaultCountry),
      plan: safePlan(plan),
      limits: parseLimits(req.body),
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
    res.render('admin/account-detail', { account, memberships, numbers, callsCount });
  } catch (e) { next(e); }
});

router.get('/accounts/:id/edit', async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id).lean();
    if (!account) return res.status(404).render('errors/404');
    res.render('admin/account-edit', { account, error: null });
  } catch (e) { next(e); }
});

router.post('/accounts/:id', async (req, res, next) => {
  try {
    const a = await Account.findById(req.params.id);
    if (!a) return res.status(404).render('errors/404');
    const { name, defaultLocale, timezone, plan, defaultCountry } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).render('admin/account-edit', { account: a.toObject(), error: 'name_required' });
    }
    a.name = String(name).trim();
    a.defaultLocale = defaultLocale === 'he' ? 'he' : 'en';
    a.timezone = timezone || 'UTC';
    a.defaultCountry = safeCountry(defaultCountry || a.defaultCountry);
    a.plan = safePlan(plan || a.plan);
    a.limits = parseLimits(req.body);
    await a.save();
    await audit.record({ ...audit.fromReq(req), action: 'admin.account.update', entity: 'Account', entityId: a._id, metadata: { name: a.name } });
    res.redirect(`/admin/accounts/${a._id}`);
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
    await audit.record({ ...audit.fromReq(req), action: 'admin.provider.create', entity: 'ProviderCredential', entityId: doc._id, metadata: { provider, label } });
    res.redirect('/admin/providers');
  } catch (e) { next(e); }
});

router.get('/providers/:id/edit', async (req, res, next) => {
  try {
    const doc = await ProviderCredential.findById(req.params.id).lean();
    if (!doc) return res.status(404).render('errors/404');
    res.render('admin/provider-edit', { cred: { _id: doc._id, provider: doc.provider, label: doc.label, isDefault: doc.isDefault }, error: null });
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

router.get('/audit', async (req, res, next) => {
  try {
    const logs = await AuditLog.find({}).sort({ createdAt: -1 }).limit(500).populate('actorId', 'email name').populate('accountId', 'name slug').lean();
    res.render('admin/audit', { logs });
  } catch (e) { next(e); }
});

module.exports = router;
