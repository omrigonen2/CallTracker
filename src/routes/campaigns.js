'use strict';

const express = require('express');
const Campaign = require('../models/Campaign');
const { requirePermission } = require('../middleware/rbac');
const audit = require('../services/audit');
const countries = require('../utils/countries');

const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// Sanitize an HH:mm time string. Returns the fallback if the input is malformed.
function sanitizeTime(v, fallback) {
  if (!v) return fallback;
  const m = String(v).match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : fallback;
}

// Combine "<base>_dial" + "<base>_national" body fields into a strict E.164 string.
// Falls back to a single-string "<base>" field for backward compatibility.
function readPhone(body, base) {
  if (body[`${base}_national`] != null || body[`${base}_dial`] != null) {
    return countries.joinE164(body[`${base}_dial`], body[`${base}_national`]);
  }
  return body[base] || '';
}

const router = express.Router();

router.get('/', requirePermission('campaign.read'), async (req, res, next) => {
  try {
    const campaigns = await Campaign.find({}).sort({ createdAt: -1 }).lean();
    res.render('campaigns/list', { campaigns });
  } catch (e) { next(e); }
});

router.get('/new', requirePermission('campaign.write'), (req, res) => {
  res.render('campaigns/edit', { campaign: null });
});

router.get('/:id/edit', requirePermission('campaign.write'), async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).render('errors/404');
    res.render('campaigns/edit', { campaign });
  } catch (e) { next(e); }
});

function parseRules(body) {
  const rules = [];
  const indexes = [].concat(body.ruleIndex || []);
  const starts = [].concat(body.ruleStart || []);
  const ends = [].concat(body.ruleEnd || []);

  for (let i = 0; i < indexes.length; i++) {
    const idx = indexes[i];
    const forwardTo = readPhone(body, `ruleForward_${idx}`);
    if (!forwardTo) continue;
    let days = body[`ruleDays_${idx}`];
    if (days == null) days = [];
    if (!Array.isArray(days)) days = [days];
    days = days.map((d) => String(d).toLowerCase()).filter((d) => VALID_DAYS.includes(d));
    rules.push({
      days,
      hoursStart: sanitizeTime(starts[i], '00:00'),
      hoursEnd: sanitizeTime(ends[i], '23:59'),
      forwardTo,
    });
  }
  return rules;
}

router.post('/', requirePermission('campaign.write'), async (req, res, next) => {
  try {
    const { name, status, timezone, recordCalls, qualifiedSeconds, whisperEnabled, ivrEnabled } = req.body;
    const c = await Campaign.create({
      name,
      status: status === 'paused' ? 'paused' : 'active',
      defaultForwardingNumber: readPhone(req.body, 'defaultForwardingNumber'),
      fallbackNumber: readPhone(req.body, 'fallbackNumber'),
      timezone: timezone || 'UTC',
      recordCalls: recordCalls === 'on',
      qualifiedSeconds: parseInt(qualifiedSeconds || '60', 10),
      whisperEnabled: whisperEnabled === 'on',
      ivrEnabled: ivrEnabled === 'on',
      routingRules: parseRules(req.body),
    });
    await audit.record({ ...audit.fromReq(req), action: 'campaign.create', entity: 'Campaign', entityId: c._id });
    res.redirect('/campaigns');
  } catch (e) { next(e); }
});

router.post('/:id', requirePermission('campaign.write'), async (req, res, next) => {
  try {
    const c = await Campaign.findById(req.params.id);
    if (!c) return res.status(404).render('errors/404');
    const { name, status, timezone, recordCalls, qualifiedSeconds, whisperEnabled, ivrEnabled } = req.body;
    Object.assign(c, {
      name,
      status: status === 'paused' ? 'paused' : 'active',
      defaultForwardingNumber: readPhone(req.body, 'defaultForwardingNumber'),
      fallbackNumber: readPhone(req.body, 'fallbackNumber'),
      timezone,
      recordCalls: recordCalls === 'on',
      qualifiedSeconds: parseInt(qualifiedSeconds || '60', 10),
      whisperEnabled: whisperEnabled === 'on',
      ivrEnabled: ivrEnabled === 'on',
      routingRules: parseRules(req.body),
    });
    await c.save();
    await audit.record({ ...audit.fromReq(req), action: 'campaign.update', entity: 'Campaign', entityId: c._id });
    res.redirect('/campaigns');
  } catch (e) { next(e); }
});

router.post('/:id/delete', requirePermission('campaign.delete'), async (req, res, next) => {
  try {
    const c = await Campaign.findOneAndDelete({ _id: req.params.id });
    if (c) await audit.record({ ...audit.fromReq(req), action: 'campaign.delete', entity: 'Campaign', entityId: c._id });
    res.redirect('/campaigns');
  } catch (e) { next(e); }
});

module.exports = router;
