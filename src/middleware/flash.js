'use strict';

// Lightweight one-shot flash via signed cookie (no session store needed).
const COOKIE = '_flash';

function read(req, res, next) {
  let messages = [];
  if (req.cookies && req.cookies[COOKIE]) {
    try { messages = JSON.parse(req.cookies[COOKIE]); } catch (e) {}
    res.clearCookie(COOKIE, { path: '/' });
  }
  res.locals.flash = messages;
  res.flash = (type, message) => {
    messages.push({ type, message });
    res.cookie(COOKIE, JSON.stringify(messages), { path: '/', httpOnly: true, sameSite: 'lax' });
  };
  next();
}

module.exports = { read };
