'use strict';

const express = require('express');
const Campaign = require('../models/Campaign');
const PostbackLog = require('../models/PostbackLog');
const { requirePermission } = require('../middleware/rbac');
const audit = require('../services/audit');

const router = express.Router();

const VALID_TRIGGERS = ['call_started', 'call_answered', 'call_completed', 'call_qualified', 'call_tagged'];

router.get('/', requirePermission('postback.read'), async (req, res, next) => {
  try {
    const campaigns = await Campaign.find({}, 'name postbackConfigs').lean();
    const recentLogs = await PostbackLog.find({}).sort({ createdAt: -1 }).limit(50).lean();
    res.render('postbacks/list', { campaigns, recentLogs });
  } catch (e) { next(e); }
});

router.get('/edit/:campaignId', requirePermission('postback.manage'), async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.campaignId);
    if (!campaign) return res.status(404).render('errors/404');
    res.render('postbacks/edit', { campaign });
  } catch (e) { next(e); }
});

router.post('/edit/:campaignId', requirePermission('postback.manage'), async (req, res, next) => {
  try {
    const c = await Campaign.findById(req.params.campaignId);
    if (!c) return res.status(404).render('errors/404');

    const indexes = [].concat(req.body.pbIndex || []);
    const names = [].concat(req.body.pbName || []);
    const urls = [].concat(req.body.pbUrl || []);
    const methods = [].concat(req.body.pbMethod || []);
    const out = [];
    for (let i = 0; i < indexes.length; i++) {
      if (!urls[i]) continue;
      const idx = indexes[i];
      let trig = req.body[`pbTriggers_${idx}`];
      if (trig == null) trig = [];
      if (!Array.isArray(trig)) trig = [trig];
      trig = trig.map((s) => String(s)).filter((s) => VALID_TRIGGERS.includes(s));
      out.push({
        name: names[i] || `Postback ${i + 1}`,
        url: urls[i],
        method: methods[i] === 'GET' ? 'GET' : 'POST',
        triggers: trig,
        enabled: req.body[`pbEnabled_${idx}`] === 'on',
      });
    }
    c.postbackConfigs = out;
    await c.save();
    await audit.record({ ...audit.fromReq(req), action: 'postback.update', entity: 'Campaign', entityId: c._id });
    res.redirect('/postbacks');
  } catch (e) { next(e); }
});

router.get('/logs', requirePermission('postback.read'), async (req, res, next) => {
  try {
    const logs = await PostbackLog.find({}).sort({ createdAt: -1 }).limit(500).lean();
    res.render('postbacks/logs', { logs });
  } catch (e) { next(e); }
});

module.exports = router;
