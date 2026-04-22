'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const log = require('../utils/logger');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!config.smtp.host) {
    transporter = {
      sendMail: async (opts) => {
        log.info({ to: opts.to, subject: opts.subject }, '[email:dev] sending email (no SMTP configured)');
        return { messageId: 'dev', accepted: [opts.to] };
      },
    };
  } else {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

async function send({ to, subject, html, text }) {
  const t = getTransporter();
  return t.sendMail({ from: config.smtp.from, to, subject, html, text });
}

module.exports = { send };
