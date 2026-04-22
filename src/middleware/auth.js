'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const log = require('../utils/logger');
const User = require('../models/User');
const Membership = require('../models/Membership');
const Account = require('../models/Account');
const Role = require('../models/Role');
const { resolvePermissions } = require('../services/rbac');
const ctx = require('../utils/asyncContext');

function signSession({ userId, accountId, impersonate }) {
  return jwt.sign(
    {
      uid: String(userId),
      aid: accountId ? String(accountId) : null,
      imp: impersonate ? 1 : 0,
    },
    config.jwtSecret,
    { expiresIn: '30d' },
  );
}

function setSessionCookie(res, token) {
  res.cookie(config.cookie.name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.cookie.maxAgeMs,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(config.cookie.name, { path: '/' });
}

async function loadSession(req, _res, next) {
  const token = req.cookies && req.cookies[config.cookie.name];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(payload.uid);
    if (!user) return next();
    req.user = user;
    req.sessionAccountId = payload.aid || null;
    req.sessionImpersonating = !!payload.imp;
  } catch (e) {
    // invalid token
  }
  next();
}

async function loadAccount(req, res, next) {
  if (!req.user) return next();

  req.memberships = [];
  req.accounts = [];
  req.account = null;
  req.permissions = new Set();
  res.locals.user = req.user;
  res.locals.account = null;
  res.locals.accounts = [];
  res.locals.hasAccount = false;
  res.locals.isSuperAdmin = !!req.user.isSuperAdmin;
  res.locals.permissions = req.permissions;
  res.locals.can = (perm) => req.user.isSuperAdmin || req.permissions.has(perm);
  res.locals.creditsBalance = null;

  let accountId = null;
  let account = null;

  try {
    const memberships = await Membership.find({ userId: req.user._id, status: 'active' })
      .populate('accountId')
      .lean();
    req.memberships = memberships;
    req.accounts = memberships.map((m) => m.accountId).filter(Boolean);

    const slugSwitch = req.query.account;
    if (slugSwitch) {
      account = req.accounts.find((a) => a && a.slug === slugSwitch);
      if (account) {
        const token = signSession({ userId: req.user._id, accountId: account._id });
        setSessionCookie(res, token);
      }
    }

    if (!account && req.sessionAccountId) {
      account = req.accounts.find((a) => a && String(a._id) === String(req.sessionAccountId));
    }
    if (!account && req.accounts.length) {
      account = req.accounts[0];
    }

    if (!account && req.user.isSuperAdmin && req.sessionImpersonating && req.sessionAccountId) {
      const impAccount = await Account.findById(req.sessionAccountId).lean();
      if (impAccount && impAccount.status !== 'deleted') {
        account = impAccount;
        req.impersonating = true;
      }
    }

    if (account) {
      req.account = account;
      accountId = account._id;
      res.locals.creditsBalance = Number(account.credits) || 0;
    }

    req.permissions = await resolvePermissions({ user: req.user, accountId });
  } catch (err) {
    log.error({ err: err.message, userId: String(req.user._id) }, 'loadAccount failed');
  }

  res.locals.account = req.account;
  res.locals.accounts = req.accounts;
  res.locals.hasAccount = !!req.account;
  res.locals.impersonating = !!req.impersonating;
  res.locals.permissions = req.permissions;
  res.locals.can = (perm) => req.user.isSuperAdmin || req.permissions.has(perm);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.accepts('html')) return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
    return res.status(401).json({ error: 'unauthenticated' });
  }
  next();
}

function requireAccount(req, res, next) {
  if (!req.account) {
    if (req.user && req.user.isSuperAdmin) {
      if (req.accepts('html')) return res.redirect('/admin');
      return res.status(200).json({ redirect: '/admin' });
    }
    if (req.accepts('html')) return res.redirect('/auth/no-account');
    return res.status(403).json({ error: 'no_account' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || !req.user.isSuperAdmin) {
    return res.status(403).render('errors/403', { reason: 'super_admin_required' });
  }
  next();
}

function withTenantContext(req, _res, next) {
  if (!req.account) return next();
  ctx.runWith(
    { accountId: req.account._id, userId: req.user ? req.user._id : null },
    () => next()
  );
}

module.exports = {
  signSession,
  setSessionCookie,
  clearSessionCookie,
  loadSession,
  loadAccount,
  requireAuth,
  requireAccount,
  requireSuperAdmin,
  withTenantContext,
};
