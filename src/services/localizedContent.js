'use strict';

const LocalizedTemplate = require('../models/LocalizedTemplate');

function interpolate(str, vars) {
  if (!str) return '';
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ''));
}

/**
 * Resolve a localized template (account override > system default) and
 * interpolate variables.
 */
async function render({ accountId, channel, key, locale, vars }) {
  let tmpl = null;
  if (accountId) tmpl = await LocalizedTemplate.findOne({ accountId, channel, key }).lean();
  if (!tmpl) tmpl = await LocalizedTemplate.findOne({ accountId: null, channel, key }).lean();
  if (!tmpl) return '';
  const txt = (tmpl.translations && (tmpl.translations[locale] || tmpl.translations.en)) || '';
  return interpolate(txt, vars);
}

module.exports = { render, interpolate };
