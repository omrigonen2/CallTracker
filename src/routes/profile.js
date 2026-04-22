'use strict';

const express = require('express');
const User = require('../models/User');
const config = require('../config');

const router = express.Router();

// Mounted under /profile after auth+account+context have been applied.
router.get('/', (req, res) => {
  res.render('profile', { error: null, success: null });
});

router.post('/', async (req, res, next) => {
  try {
    const { name, locale, password } = req.body;
    const u = await User.findById(req.user._id);
    if (name) u.name = name;
    if (locale && config.locales.includes(locale)) u.locale = locale;
    if (password) u.passwordHash = await User.hashPassword(password);
    await u.save();
    res.cookie('lng', u.locale, { path: '/', httpOnly: false, sameSite: 'lax' });
    res.locals.user = u;
    req.user = u;
    res.render('profile', { error: null, success: true });
  } catch (e) { next(e); }
});

module.exports = router;
