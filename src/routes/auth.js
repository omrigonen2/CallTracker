'use strict';

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Account = require('../models/Account');
const Membership = require('../models/Membership');
const Role = require('../models/Role');
const Invitation = require('../models/Invitation');
const { signSession, setSessionCookie, clearSessionCookie } = require('../middleware/auth');
const audit = require('../services/audit');
const { send } = require('../services/email');
const config = require('../config');

const router = express.Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'account';
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/login', { layout: 'auth', next: req.query.next || '/', error: null });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password, next: nextUrl } = req.body;
    const user = await User.findOne({ email: String(email || '').toLowerCase().trim() });
    if (!user || !(await user.verifyPassword(password || ''))) {
      return res.status(401).render('auth/login', { layout: 'auth', next: nextUrl || '/', error: 'invalid_credentials' });
    }
    user.lastLoginAt = new Date();
    await user.save();
    const token = signSession({ userId: user._id, accountId: null });
    setSessionCookie(res, token);
    await audit.record({ actorId: user._id, action: 'auth.login', entity: 'User', entityId: user._id, ip: req.ip, userAgent: req.get('user-agent') });
    res.redirect(nextUrl || '/');
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.redirect('/auth/login');
});

router.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/signup', { layout: 'auth', error: null });
});

router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, name, accountName } = req.body;
    if (!email || !password || !name || !accountName) {
      return res.status(400).render('auth/signup', { layout: 'auth', error: 'missing_fields' });
    }
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(400).render('auth/signup', { layout: 'auth', error: 'email_taken' });

    const passwordHash = await User.hashPassword(password);
    const user = await User.create({ email: email.toLowerCase().trim(), name, passwordHash });

    let slug = slugify(accountName);
    let i = 0;
    while (await Account.findOne({ slug })) { i++; slug = `${slugify(accountName)}-${i}`; }

    const account = await Account.create({ name: accountName, slug, defaultLocale: req.language || 'en' });
    const ownerRole = await Role.findOne({ key: 'owner', isSystem: true });
    await Membership.create({ accountId: account._id, userId: user._id, roleIds: ownerRole ? [ownerRole._id] : [], status: 'active' });

    const token = signSession({ userId: user._id, accountId: account._id });
    setSessionCookie(res, token);
    await audit.record({ accountId: account._id, actorId: user._id, action: 'auth.signup', entity: 'Account', entityId: account._id, ip: req.ip, userAgent: req.get('user-agent') });
    res.redirect('/');
  } catch (e) { next(e); }
});

router.get('/forgot', (req, res) => res.render('auth/forgot', { layout: 'auth', sent: false }));

router.post('/forgot', async (req, res, next) => {
  try {
    const user = await User.findOne({ email: String(req.body.email || '').toLowerCase().trim() });
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = Date.now() + 60 * 60 * 1000;
      // Store on user doc (transient)
      user.set('resetToken', token);
      user.set('resetExpires', expires);
      await user.save();
      const url = `${config.baseUrl}/auth/reset?token=${token}`;
      await send({ to: user.email, subject: 'Password reset', html: `<p>Reset your password: <a href="${url}">${url}</a></p>` });
    }
    res.render('auth/forgot', { layout: 'auth', sent: true });
  } catch (e) { next(e); }
});

router.get('/reset', (req, res) => res.render('auth/reset', { layout: 'auth', token: req.query.token, error: null }));

router.post('/reset', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    const user = await User.findOne({ resetToken: token });
    if (!user || !user.get('resetExpires') || user.get('resetExpires') < Date.now()) {
      return res.status(400).render('auth/reset', { layout: 'auth', token, error: 'invalid_or_expired' });
    }
    user.passwordHash = await User.hashPassword(password);
    user.set('resetToken', undefined);
    user.set('resetExpires', undefined);
    await user.save();
    res.redirect('/auth/login');
  } catch (e) { next(e); }
});

// Invitation accept (token in URL)
router.get('/accept-invite', async (req, res, next) => {
  try {
    const inv = await Invitation.findOne({ token: req.query.token, status: 'pending' });
    if (!inv || inv.expiresAt < new Date()) return res.status(400).render('auth/accept-invite', { layout: 'auth', invalid: true });
    const account = await Account.findById(inv.accountId);
    res.render('auth/accept-invite', { layout: 'auth', invalid: false, invitation: inv, account, error: null });
  } catch (e) { next(e); }
});

router.post('/accept-invite', async (req, res, next) => {
  try {
    const { token, name, password } = req.body;
    const inv = await Invitation.findOne({ token, status: 'pending' });
    if (!inv || inv.expiresAt < new Date()) return res.status(400).render('auth/accept-invite', { layout: 'auth', invalid: true });

    let user = await User.findOne({ email: inv.email });
    if (!user) {
      user = await User.create({ email: inv.email, name, passwordHash: await User.hashPassword(password) });
    }
    await Membership.findOneAndUpdate(
      { accountId: inv.accountId, userId: user._id },
      { $set: { roleIds: inv.roleIds, status: 'active', joinedAt: new Date() } },
      { upsert: true }
    );
    inv.status = 'accepted';
    await inv.save();
    const sess = signSession({ userId: user._id, accountId: inv.accountId });
    setSessionCookie(res, sess);
    res.redirect('/');
  } catch (e) { next(e); }
});

// "no-account" landing
router.get('/no-account', (req, res) => res.render('auth/no-account', { layout: 'auth' }));

module.exports = router;
