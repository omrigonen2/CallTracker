'use strict';

const express = require('express');
const Call = require('../models/Call');
const Campaign = require('../models/Campaign');
const PhoneNumber = require('../models/PhoneNumber');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const accountId = req.account._id;

    const [
      totalCalls,
      recentCalls,
      campaignsCount,
      numbersCount,
      agg,
      dailyAgg,
      bySourceAgg,
    ] = await Promise.all([
      Call.countDocuments({ createdAt: { $gte: since } }),
      Call.find({}).sort({ createdAt: -1 }).limit(8).populate('campaignId', 'name').lean(),
      Campaign.countDocuments({}),
      PhoneNumber.countDocuments({ status: 'active' }),
      Call.aggregate([
        { $match: { accountId, createdAt: { $gte: since } } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            answered: { $sum: { $cond: [{ $in: ['$status', ['completed', 'in-progress']] }, 1, 0] } },
            converted: { $sum: { $cond: [{ $eq: ['$outcome', 'converted'] }, 1, 0] } },
            durationSum: { $sum: '$duration' },
          },
        },
      ]),
      Call.aggregate([
        { $match: { accountId, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Call.aggregate([
        { $match: { accountId, createdAt: { $gte: since } } },
        { $group: { _id: '$campaignId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const m = agg[0] || { count: 0, answered: 0, durationSum: 0, converted: 0 };
    const answerRate = m.count ? Math.round((m.answered / m.count) * 100) : 0;
    const avgDuration = m.count ? Math.round(m.durationSum / m.count) : 0;
    const conversionRate = m.count ? Math.round((m.converted / m.count) * 100) : 0;

    const campaigns = await Campaign.find({ _id: { $in: bySourceAgg.map((r) => r._id) } }, 'name').lean();
    const campMap = Object.fromEntries(campaigns.map((c) => [String(c._id), c.name]));
    const topSources = bySourceAgg.map((r) => ({
      name: r._id ? campMap[String(r._id)] || '—' : '—',
      count: r.count,
    }));
    const topMax = topSources.reduce((a, r) => Math.max(a, r.count), 0) || 1;

    const chart = {
      type: 'line',
      labels: dailyAgg.map((d) => d._id),
      series: [{ label: req.t('dashboard.call_volume'), data: dailyAgg.map((d) => d.count) }],
    };

    res.render('dashboard', {
      pageTitle: req.t('nav.dashboard'),
      totalCalls,
      campaignsCount,
      numbersCount,
      answerRate,
      avgDuration,
      conversionRate,
      answeredCalls: m.answered,
      recentCalls,
      topSources,
      topMax,
      chart,
    });
  } catch (e) { next(e); }
});

module.exports = router;
