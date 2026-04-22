'use strict';

const express = require('express');
const Call = require('../models/Call');
const Campaign = require('../models/Campaign');
const { requirePermission } = require('../middleware/rbac');

const router = express.Router();

router.get('/', requirePermission('analytics.read'), async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const byCampaign = await Call.aggregate([
      { $match: { accountId: req.account._id, createdAt: { $gte: since } } },
      {
        $group: {
          _id: '$campaignId',
          count: { $sum: 1 },
          totalDuration: { $sum: '$duration' },
          qualified: { $sum: { $cond: ['$qualified', 1, 0] } },
          converted: { $sum: { $cond: [{ $eq: ['$outcome', 'converted'] }, 1, 0] } },
        },
      },
    ]);
    const campaigns = await Campaign.find({}, 'name').lean();
    const campMap = Object.fromEntries(campaigns.map((c) => [String(c._id), c.name]));

    const dailyAgg = await Call.aggregate([
      { $match: { accountId: req.account._id, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.render('analytics/index', {
      byCampaign: byCampaign.map((r) => ({ ...r, name: campMap[String(r._id)] || '—' })),
      daily: dailyAgg,
    });
  } catch (e) { next(e); }
});

module.exports = router;
