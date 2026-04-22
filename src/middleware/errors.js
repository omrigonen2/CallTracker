'use strict';

const log = require('../utils/logger');

function notFound(req, res) {
  if (req.accepts('html')) return res.status(404).render('errors/404');
  res.status(404).json({ error: 'not_found' });
}

function handler(err, req, res, _next) {
  log.error({ err: err.message, stack: err.stack, url: req.originalUrl }, 'request error');
  const status = err.status || 500;
  if (req.accepts('html')) {
    return res.status(status).render('errors/500', { message: err.message });
  }
  res.status(status).json({ error: err.code || 'server_error', message: err.message });
}

module.exports = { notFound, handler };
