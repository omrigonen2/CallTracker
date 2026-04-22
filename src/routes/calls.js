'use strict';

const express = require('express');
const Call = require('../models/Call');
const Campaign = require('../models/Campaign');
const { requirePermission } = require('../middleware/rbac');
const audit = require('../services/audit');

const router = express.Router();

router.get('/', requirePermission('call.read'), async (req, res, next) => {
  try {
    const { campaign, minDuration, tag } = req.query;
    const filter = {};
    if (campaign) filter.campaignId = campaign;
    if (minDuration) filter.duration = { $gte: parseInt(minDuration, 10) };
    if (tag) filter.tags = tag;
    const calls = await Call.find(filter).sort({ createdAt: -1 }).limit(200).populate('campaignId', 'name').lean();
    const campaigns = await Campaign.find({}, 'name').lean();
    const totalCount = calls.length;
    const answeredCount = calls.filter((c) => ['completed', 'in-progress'].includes(c.status)).length;
    const answerRate = totalCount ? Math.round((answeredCount / totalCount) * 100) : 0;
    res.render('calls/list', { calls, campaigns, query: req.query, totalCount, answeredCount, answerRate });
  } catch (e) { next(e); }
});

router.get('/:id', requirePermission('call.read'), async (req, res, next) => {
  try {
    const call = await Call.findById(req.params.id).populate('campaignId', 'name').populate('phoneNumberId', 'phoneNumber').lean();
    if (!call) return res.status(404).render('errors/404');
    res.render('calls/detail', { call });
  } catch (e) { next(e); }
});

router.post('/:id/tag', requirePermission('call.tag'), async (req, res, next) => {
  try {
    const { tag } = req.body;
    const call = await Call.findById(req.params.id);
    if (!call) return res.status(404).render('errors/404');
    if (tag && !call.tags.includes(tag)) call.tags.push(tag);
    await call.save();
    await audit.record({ ...audit.fromReq(req), action: 'call.tag.add', entity: 'Call', entityId: call._id, metadata: { tag } });
    res.redirect(`/calls/${call._id}`);
  } catch (e) { next(e); }
});

router.post('/:id/untag', requirePermission('call.tag'), async (req, res, next) => {
  try {
    const { tag } = req.body;
    const call = await Call.findById(req.params.id);
    if (!call) return res.status(404).render('errors/404');
    call.tags = call.tags.filter((t) => t !== tag);
    await call.save();
    res.redirect(`/calls/${call._id}`);
  } catch (e) { next(e); }
});

router.post('/:id/outcome', requirePermission('call.tag'), async (req, res, next) => {
  try {
    const { outcome } = req.body;
    const call = await Call.findById(req.params.id);
    if (!call) return res.status(404).render('errors/404');
    call.outcome = ['converted', 'not_relevant', 'spam', ''].includes(outcome) ? outcome : '';
    await call.save();
    await audit.record({ ...audit.fromReq(req), action: 'call.outcome', entity: 'Call', entityId: call._id, metadata: { outcome } });
    res.redirect(`/calls/${call._id}`);
  } catch (e) { next(e); }
});

router.post('/:id/note', requirePermission('call.note'), async (req, res, next) => {
  try {
    const { note } = req.body;
    const call = await Call.findById(req.params.id);
    if (!call) return res.status(404).render('errors/404');
    call.notes = note || '';
    await call.save();
    res.redirect(`/calls/${call._id}`);
  } catch (e) { next(e); }
});

router.get('/export.csv', requirePermission('call.export'), async (req, res, next) => {
  try {
    const calls = await Call.find({}).sort({ createdAt: -1 }).limit(5000).lean();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=calls.csv');
    res.write('id,createdAt,campaignId,callerNumber,destinationNumber,duration,status,outcome,tags\n');
    for (const c of calls) {
      res.write(`${c._id},${c.createdAt.toISOString()},${c.campaignId || ''},${c.callerNumber || ''},${c.destinationNumber || ''},${c.duration || 0},${c.status},${c.outcome || ''},"${(c.tags || []).join('|')}"\n`);
    }
    res.end();
  } catch (e) { next(e); }
});

module.exports = router;
