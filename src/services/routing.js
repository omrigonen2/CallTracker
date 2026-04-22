'use strict';

const { DateTime } = require('luxon');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function timeInRange(now, start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const cur = now.hour * 60 + now.minute;
  return cur >= sh * 60 + sm && cur <= eh * 60 + em;
}

/**
 * Resolve forwarding destination for an inbound call given:
 * - PhoneNumber doc (may contain forwardingOverride)
 * - Campaign doc (defaults + routing rules)
 * Priority: number-level override > matching routing rule > campaign default
 */
function resolveForwardTo({ phoneNumberDoc, campaignDoc }) {
  if (phoneNumberDoc && phoneNumberDoc.forwardingOverride) {
    return { forwardTo: phoneNumberDoc.forwardingOverride, fallbackTo: '' };
  }
  if (!campaignDoc) return { forwardTo: '', fallbackTo: '' };

  const tz = campaignDoc.timezone || 'UTC';
  const now = DateTime.now().setZone(tz);
  const today = DAYS[now.weekday % 7]; // luxon: 1=Mon..7=Sun

  for (const rule of campaignDoc.routingRules || []) {
    if (rule.days && rule.days.length && !rule.days.includes(today)) continue;
    if (!timeInRange(now, rule.hoursStart || '00:00', rule.hoursEnd || '23:59')) continue;
    return { forwardTo: rule.forwardTo, fallbackTo: rule.fallbackTo || campaignDoc.fallbackNumber || '' };
  }
  return { forwardTo: campaignDoc.defaultForwardingNumber || '', fallbackTo: campaignDoc.fallbackNumber || '' };
}

module.exports = { resolveForwardTo };
