#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'locales');
const baseLocale = 'en';
const otherLocales = fs.readdirSync(root).filter((d) => d !== baseLocale && fs.statSync(path.join(root, d)).isDirectory());

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

function readNs(locale) {
  const dir = path.join(root, locale);
  const result = {};
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const ns = file.replace(/\.json$/, '');
    result[ns] = flatten(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
  }
  return result;
}

const base = readNs(baseLocale);
let totalMissing = 0;
const report = [];
for (const loc of otherLocales) {
  const other = readNs(loc);
  for (const ns of Object.keys(base)) {
    const baseKeys = Object.keys(base[ns] || {});
    const otherKeys = new Set(Object.keys((other[ns] || {})));
    const missing = baseKeys.filter((k) => !otherKeys.has(k));
    if (missing.length) {
      report.push(`[${loc}] ${ns}: missing ${missing.length} keys`);
      missing.forEach((k) => report.push(`  - ${ns}.${k}`));
      totalMissing += missing.length;
    }
  }
}

if (totalMissing > 0) {
  console.error(report.join('\n'));
  console.error(`\nTotal missing: ${totalMissing}`);
  process.exit(1);
}
console.log('All locales complete.');
