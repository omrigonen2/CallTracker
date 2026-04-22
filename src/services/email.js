'use strict';

const config = require('../config');
const systemSettings = require('./systemSettings');
const log = require('../utils/logger');

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/**
 * Send a transactional email via Resend's HTTP API.
 *
 * Mail settings (API key, from address) are read from the SystemSetting
 * singleton through `systemSettings`, which is cached for ~30s. When mail
 * is unconfigured we throw in production but fall back to a dev log-stub
 * locally so test/dev flows that send invitations or reset links don't
 * crash on a missing key.
 */
async function send({ to, subject, html, text, from, replyTo }) {
  const [apiKey, mail] = await Promise.all([
    systemSettings.getResendApiKey(),
    systemSettings.getMail(),
  ]);
  const fromAddr = from || mail.fromEmail;

  if (!apiKey || !fromAddr) {
    if (config.isProd) {
      throw new Error('mail not configured: set Resend API key and From email in /admin/settings');
    }
    log.info({ to, subject }, '[email:dev] mail not configured; logging only');
    return { id: 'dev', accepted: [].concat(to) };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        reply_to: replyTo || mail.replyTo || undefined,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`resend ${res.status}: ${body.slice(0, 300)}`);
    }
    return await res.json().catch(() => ({}));
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`resend timeout after ${TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { send };
