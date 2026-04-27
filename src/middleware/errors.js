'use strict';

const twilio = require('twilio');
const log = require('../utils/logger');

function notFound(req, res) {
  if (req.accepts('html')) return res.status(404).render('errors/404');
  res.status(404).json({ error: 'not_found' });
}

function twimlVoiceErrorSaid() {
  const r = new twilio.twiml.VoiceResponse();
  r.say('We are sorry, a technical error has occurred. Please try again later.');
  return r.toString();
}

function handler(err, req, res, _next) {
  log.error({ err: err.message, stack: err.stack, url: req.originalUrl }, 'request error');
  const status = err.status || 500;
  if (req.originalUrl && String(req.originalUrl).startsWith('/webhooks')) {
    res.type('text/xml');
    return res.status(200).send(twimlVoiceErrorSaid());
  }
  if (req.accepts('html')) {
    return res.status(status).render('errors/500', { message: err.message });
  }
  res.status(status).json({ error: err.code || 'server_error', message: err.message });
}

module.exports = { notFound, handler };
