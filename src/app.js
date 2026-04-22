'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const compression = require('compression');
const pinoHttp = require('pino-http');

const log = require('./utils/logger');
const config = require('./config');
const i18n = require('./middleware/i18n');
const flash = require('./middleware/flash');
const auth = require('./middleware/auth');
const errors = require('./middleware/errors');
const User = require('./models/User');

async function build() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  app.use(pinoHttp({ logger: log }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // i18n must be initialized before the middleware can run.
  const i18nMiddleware = await i18n.init();
  app.use(i18nMiddleware);

  app.use(flash.read);
  app.use(auth.loadSession);

  // Webhooks: NO auth, NO tenant context (resolved by destination number).
  app.use('/webhooks', require('./routes/webhooks'));

  // Public language switcher (works whether logged-in or not).
  app.post('/lang', (req, res) => {
    const { locale, redirect } = req.body;
    if (config.locales.includes(locale)) {
      res.cookie('lng', locale, { path: '/', httpOnly: false, sameSite: 'lax' });
      if (req.user) User.updateOne({ _id: req.user._id }, { $set: { locale } }).catch(() => {});
    }
    res.redirect(redirect || req.get('referer') || '/');
  });

  app.use((req, res, next) => {
    res.locals.currentUrl = req.originalUrl;
    next();
  });

  // i18n locals binder — uses req.user.locale if authenticated; account default
  // is patched in later by loadAccount/views.
  app.use(i18n.localsBinder);

  app.use('/auth', require('./routes/auth'));

  // Past this point: must be authenticated.
  app.use(auth.requireAuth);
  app.use(auth.loadAccount);
  // After loadAccount, re-bind locale to honor account default if user has none.
  app.use(i18n.localsBinder);

  // Super-Admin console: doesn't require an account membership.
  app.use('/admin', require('./routes/admin'));

  // Exit impersonation must be reachable from inside a workspace too,
  // so it lives outside /admin and only requires an authenticated user.
  app.post('/exit-impersonation', async (req, res, next) => {
    try {
      if (req.user && req.user.isSuperAdmin) {
        const token = auth.signSession({ userId: req.user._id, accountId: null, impersonate: false });
        auth.setSessionCookie(res, token);
        const audit = require('./services/audit');
        await audit.record({
          accountId: req.account ? req.account._id : null,
          actorId: req.user._id,
          action: 'admin.account.impersonate.stop',
          entity: 'Account',
          entityId: req.account ? req.account._id : null,
          ip: req.ip,
          userAgent: req.get('user-agent') || '',
        });
      }
      res.redirect('/admin');
    } catch (e) { next(e); }
  });

  // All remaining routes require an active account context.
  app.use(auth.requireAccount);
  app.use(auth.withTenantContext);

  app.use('/profile', require('./routes/profile'));
  app.use('/account', require('./routes/account'));
  app.use('/users', require('./routes/users'));
  app.use('/roles', require('./routes/roles'));
  app.use('/campaigns', require('./routes/campaigns'));
  app.use('/numbers', require('./routes/numbers'));
  app.use('/calls', require('./routes/calls'));
  app.use('/postbacks', require('./routes/postbacks'));
  app.use('/analytics', require('./routes/analytics'));
  app.use('/', require('./routes/dashboard'));

  app.use(errors.notFound);
  app.use(errors.handler);

  return app;
}

module.exports = { build };
