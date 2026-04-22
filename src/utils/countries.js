'use strict';

// Curated ISO 3166-1 alpha-2 list with E.164 dial codes.
// Trimmed to the most common business markets — extend as needed.
const COUNTRIES = [
  { iso: 'US', name: 'United States', dial: '1', flag: 'US' },
  { iso: 'CA', name: 'Canada', dial: '1', flag: 'CA' },
  { iso: 'GB', name: 'United Kingdom', dial: '44', flag: 'GB' },
  { iso: 'IE', name: 'Ireland', dial: '353', flag: 'IE' },
  { iso: 'AU', name: 'Australia', dial: '61', flag: 'AU' },
  { iso: 'NZ', name: 'New Zealand', dial: '64', flag: 'NZ' },
  { iso: 'IL', name: 'Israel', dial: '972', flag: 'IL' },
  { iso: 'DE', name: 'Germany', dial: '49', flag: 'DE' },
  { iso: 'FR', name: 'France', dial: '33', flag: 'FR' },
  { iso: 'ES', name: 'Spain', dial: '34', flag: 'ES' },
  { iso: 'IT', name: 'Italy', dial: '39', flag: 'IT' },
  { iso: 'NL', name: 'Netherlands', dial: '31', flag: 'NL' },
  { iso: 'BE', name: 'Belgium', dial: '32', flag: 'BE' },
  { iso: 'CH', name: 'Switzerland', dial: '41', flag: 'CH' },
  { iso: 'AT', name: 'Austria', dial: '43', flag: 'AT' },
  { iso: 'SE', name: 'Sweden', dial: '46', flag: 'SE' },
  { iso: 'NO', name: 'Norway', dial: '47', flag: 'NO' },
  { iso: 'DK', name: 'Denmark', dial: '45', flag: 'DK' },
  { iso: 'FI', name: 'Finland', dial: '358', flag: 'FI' },
  { iso: 'PT', name: 'Portugal', dial: '351', flag: 'PT' },
  { iso: 'PL', name: 'Poland', dial: '48', flag: 'PL' },
  { iso: 'CZ', name: 'Czechia', dial: '420', flag: 'CZ' },
  { iso: 'GR', name: 'Greece', dial: '30', flag: 'GR' },
  { iso: 'RO', name: 'Romania', dial: '40', flag: 'RO' },
  { iso: 'HU', name: 'Hungary', dial: '36', flag: 'HU' },
  { iso: 'TR', name: 'Turkey', dial: '90', flag: 'TR' },
  { iso: 'RU', name: 'Russia', dial: '7', flag: 'RU' },
  { iso: 'UA', name: 'Ukraine', dial: '380', flag: 'UA' },
  { iso: 'ZA', name: 'South Africa', dial: '27', flag: 'ZA' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971', flag: 'AE' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966', flag: 'SA' },
  { iso: 'IN', name: 'India', dial: '91', flag: 'IN' },
  { iso: 'JP', name: 'Japan', dial: '81', flag: 'JP' },
  { iso: 'KR', name: 'South Korea', dial: '82', flag: 'KR' },
  { iso: 'CN', name: 'China', dial: '86', flag: 'CN' },
  { iso: 'HK', name: 'Hong Kong', dial: '852', flag: 'HK' },
  { iso: 'SG', name: 'Singapore', dial: '65', flag: 'SG' },
  { iso: 'MY', name: 'Malaysia', dial: '60', flag: 'MY' },
  { iso: 'TH', name: 'Thailand', dial: '66', flag: 'TH' },
  { iso: 'PH', name: 'Philippines', dial: '63', flag: 'PH' },
  { iso: 'ID', name: 'Indonesia', dial: '62', flag: 'ID' },
  { iso: 'VN', name: 'Vietnam', dial: '84', flag: 'VN' },
  { iso: 'BR', name: 'Brazil', dial: '55', flag: 'BR' },
  { iso: 'MX', name: 'Mexico', dial: '52', flag: 'MX' },
  { iso: 'AR', name: 'Argentina', dial: '54', flag: 'AR' },
  { iso: 'CL', name: 'Chile', dial: '56', flag: 'CL' },
  { iso: 'CO', name: 'Colombia', dial: '57', flag: 'CO' },
  { iso: 'PE', name: 'Peru', dial: '51', flag: 'PE' },
];

// Pre-sort by display name (English) once; consumers may re-sort by locale.
const SORTED = COUNTRIES.slice().sort((a, b) => a.name.localeCompare(b.name));

// Longest-first list of dial codes for prefix matching.
const DIAL_CODES = COUNTRIES
  .map((c) => c.dial)
  .filter((v, i, arr) => arr.indexOf(v) === i)
  .sort((a, b) => b.length - a.length);

function list() {
  return SORTED;
}

function isoCodes() {
  return COUNTRIES.map((c) => c.iso);
}

function isValidIso(iso) {
  return typeof iso === 'string' && COUNTRIES.some((c) => c.iso === iso.toUpperCase());
}

function dialFor(iso) {
  const c = COUNTRIES.find((x) => x.iso === String(iso || '').toUpperCase());
  return c ? c.dial : null;
}

// Convert "+15551234567" -> { dial:'1', national:'5551234567' } using known dial codes.
function splitE164(e164) {
  if (!e164) return { dial: '', national: '' };
  const s = String(e164).trim();
  if (!s.startsWith('+')) return { dial: '', national: s.replace(/[^0-9]/g, '') };
  const digits = s.slice(1).replace(/[^0-9]/g, '');
  for (const dc of DIAL_CODES) {
    if (digits.startsWith(dc)) return { dial: dc, national: digits.slice(dc.length) };
  }
  return { dial: '', national: digits };
}

// Combine dial + national input into a strict E.164 string. Returns '' on empty input.
function joinE164(dial, national) {
  const d = String(dial || '').replace(/[^0-9]/g, '');
  const n = String(national || '').replace(/[^0-9]/g, '');
  if (!n) return '';
  if (!d) return `+${n}`;
  return `+${d}${n}`;
}

module.exports = { list, isoCodes, isValidIso, dialFor, splitE164, joinE164 };
