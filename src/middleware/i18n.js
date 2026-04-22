'use strict';

const path = require('path');
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const i18nMiddleware = require('i18next-http-middleware');
const config = require('../config');
const timezones = require('../utils/timezones');
const countries = require('../utils/countries');

async function init() {
  await i18next
    .use(Backend)
    .use(i18nMiddleware.LanguageDetector)
    .init({
      backend: {
        loadPath: path.join(__dirname, '..', '..', 'locales', '{{lng}}', '{{ns}}.json'),
      },
      ns: ['common', 'auth', 'campaigns', 'calls', 'admin', 'errors', 'billing'],
      defaultNS: 'common',
      fallbackLng: config.defaultLocale,
      preload: config.locales,
      supportedLngs: config.locales,
      detection: {
        order: ['querystring', 'cookie', 'header'],
        caches: ['cookie'],
        lookupCookie: 'lng',
        lookupQuerystring: 'lng',
      },
    });
  return i18nMiddleware.handle(i18next);
}

function localsBinder(req, res, next) {
  let locale = req.language || config.defaultLocale;
  if (req.user && req.user.locale) locale = req.user.locale;
  else if (req.account && req.account.defaultLocale) locale = req.account.defaultLocale;
  if (!config.locales.includes(locale)) locale = config.defaultLocale;

  if (req.i18n && req.i18n.changeLanguage) req.i18n.changeLanguage(locale);
  res.locals.locale = locale;
  res.locals.dir = config.rtlLocales.includes(locale) ? 'rtl' : 'ltr';
  res.locals.t = (key, opts) => req.t(key, opts);
  res.locals.locales = config.locales;
  res.locals.timezones = timezones.list();
  res.locals.countries = countries.list();
  res.locals.splitE164 = countries.splitE164;
  next();
}

module.exports = { init, localsBinder, i18next };
