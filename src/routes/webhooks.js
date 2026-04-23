'use strict';

const express = require('express');
const twilio = require('twilio');
const PhoneNumber = require('../models/PhoneNumber');
const Call = require('../models/Call');
const Campaign = require('../models/Campaign');
const CallerProfile = require('../models/CallerProfile');
const credentialStore = require('../services/credentialStore');
const telnyxAdapter = require('../services/providers/telnyx');
const { resolveForwardTo } = require('../services/routing');
const { dispatch: dispatchPostback } = require('../services/postbackDispatcher');
const localized = require('../services/localizedContent');
const billing = require('../services/billing');
const pricing = require('../services/pricing');
const config = require('../config');
const log = require('../utils/logger');

const router = express.Router();

// Webhooks are PUBLIC: tenant is resolved by the called number.
// We bypass tenant scoping by NOT being inside a per-account async context.

// ---------------------------------------------------------------------------
// Signature middleware
// ---------------------------------------------------------------------------

async function verifyTwilio(req, _res, next) {
  try {
    const sig = req.get('X-Twilio-Signature');
    if (!sig) return next(); // dev convenience
    const provider = await credentialStore.get('twilio'); // default
    const url = `${config.baseUrl}${req.originalUrl}`;
    const ok = twilio.validateRequest(provider.signingSecret || provider.authToken, sig, url, req.body);
    if (!ok) return next(Object.assign(new Error('invalid_signature'), { status: 401 }));
    next();
  } catch (e) {
    log.warn({ err: e.message }, 'twilio signature check failed');
    next();
  }
}

async function _findCredentialPublicKeyForRequest(req) {
  // Resolve the credential by inbound number first (covers /voice, /status, /recording);
  // fall back to the default telnyx credential.
  const to = req.body && (req.body.To || req.body.to);
  if (to) {
    const num = await PhoneNumber.findOne({ phoneNumber: to }).setOptions({ skipTenantScope: true });
    if (num && num.providerCredentialId) {
      try {
        const c = await credentialStore.get('telnyx', num.providerCredentialId);
        if (c && c.publicKey) return c.publicKey;
      } catch (e) { log.warn({ err: e.message }, 'telnyx cred lookup by number failed'); }
    }
  }
  const sid = req.body && (req.body.CallSid || req.body.callSid);
  if (sid) {
    const call = await Call.findOne({ providerCallId: sid }).setOptions({ skipTenantScope: true });
    if (call && call.phoneNumberId) {
      const num = await PhoneNumber.findOne({ _id: call.phoneNumberId }).setOptions({ skipTenantScope: true });
      if (num && num.providerCredentialId) {
        try {
          const c = await credentialStore.get('telnyx', num.providerCredentialId);
          if (c && c.publicKey) return c.publicKey;
        } catch (e) { log.warn({ err: e.message }, 'telnyx cred lookup by call failed'); }
      }
    }
  }
  try {
    const c = await credentialStore.get('telnyx');
    return c && c.publicKey;
  } catch (_e) {
    return null;
  }
}

async function verifyTelnyx(req, _res, next) {
  try {
    const sig = req.get('Telnyx-Signature-Ed25519');
    const ts = req.get('Telnyx-Timestamp');
    if (!sig || !ts) return next(); // dev convenience (matches Twilio behavior)
    const publicKey = await _findCredentialPublicKeyForRequest(req);
    if (!publicKey) return next(Object.assign(new Error('telnyx_no_public_key'), { status: 401 }));
    const ok = telnyxAdapter.verifyWebhookSignature({
      rawBody: req.rawBody, signatureB64: sig, timestamp: ts, publicKeyB64: publicKey,
    });
    if (!ok) return next(Object.assign(new Error('invalid_signature'), { status: 401 }));
    next();
  } catch (e) {
    log.warn({ err: e.message }, 'telnyx signature check failed');
    next();
  }
}

// ---------------------------------------------------------------------------
// Shared inbound-voice handler (TwiML and TeXML are wire-compatible).
// ---------------------------------------------------------------------------

async function _handleVoiceInbound(req, res, providerName) {
  const to = req.body.To;
  const from = req.body.From;
  const callSid = req.body.CallSid;
  const num = await PhoneNumber.findOne({ phoneNumber: to }).setOptions({ skipTenantScope: true });
  if (!num) {
    const r = new twilio.twiml.VoiceResponse();
    r.say('This number is not configured.');
    return res.type('text/xml').send(r.toString());
  }

  const campaign = num.campaignId ? await Campaign.findOne({ _id: num.campaignId }).setOptions({ skipTenantScope: true }) : null;

  const profile = await CallerProfile.findOne({ accountId: num.accountId, phoneNumber: from }).setOptions({ skipTenantScope: true });
  if (profile && profile.isBlacklisted) {
    const r = new twilio.twiml.VoiceResponse();
    r.reject();
    return res.type('text/xml').send(r.toString());
  }

  const { forwardTo, fallbackTo } = resolveForwardTo({ phoneNumberDoc: num, campaignDoc: campaign });

  const call = await Call.create({
    accountId: num.accountId,
    campaignId: num.campaignId,
    phoneNumberId: num._id,
    providerCallId: callSid,
    callerNumber: from,
    destinationNumber: to,
    startTime: new Date(),
    status: 'ringing',
    isDuplicateCaller: !!profile,
  });

  await CallerProfile.findOneAndUpdate(
    { accountId: num.accountId, phoneNumber: from },
    { $inc: { totalCalls: 1 }, $set: { lastCallAt: new Date() }, $setOnInsert: { accountId: num.accountId, phoneNumber: from } },
    { upsert: true, setDefaultsOnInsert: true, ...{ skipTenantScope: true } }
  ).setOptions({ skipTenantScope: true });

  if (campaign && campaign.postbackConfigs) {
    for (const pb of campaign.postbackConfigs) {
      if (!pb.enabled) continue;
      if (pb.triggers.includes('call_started')) {
        await dispatchPostback({
          accountId: num.accountId,
          campaignId: campaign._id,
          callId: call._id,
          postback: pb,
          trigger: 'call_started',
          payload: { callerNumber: from, destinationNumber: to, providerCallId: callSid, callId: String(call._id) },
        });
      }
    }
  }

  const r = new twilio.twiml.VoiceResponse();

  if (campaign && campaign.ivrEnabled) {
    const locale = campaign && campaign.timezone ? 'en' : 'en';
    const prompt = (await localized.render({ accountId: num.accountId, channel: 'ivr', key: campaign.ivrTemplateKey, locale, vars: { campaign: campaign.name } })) || 'Press 1 for sales, 2 for support.';
    const gather = r.gather({ numDigits: 1, action: `${config.baseUrl}/webhooks/${providerName}/ivr?callId=${call._id}&forward=${encodeURIComponent(forwardTo)}`, method: 'POST' });
    gather.say(prompt);
    r.say('No input received.');
    return res.type('text/xml').send(r.toString());
  }

  if (!forwardTo) {
    r.say('No forwarding destination configured.');
    return res.type('text/xml').send(r.toString());
  }

  const dialOpts = { answerOnBridge: true };
  if (campaign && campaign.recordCalls) dialOpts.record = 'record-from-answer-dual';
  if (campaign && campaign.recordCalls) dialOpts.recordingStatusCallback = `${config.baseUrl}/webhooks/${providerName}/recording?callId=${call._id}`;
  const dial = r.dial(dialOpts);

  if (campaign && campaign.whisperEnabled) {
    dial.number({ url: `${config.baseUrl}/webhooks/${providerName}/whisper?campaignId=${campaign._id}` }, forwardTo);
  } else {
    dial.number(forwardTo);
  }
  if (fallbackTo) dial.number(fallbackTo);

  res.type('text/xml').send(r.toString());
}

async function _handleWhisper(req, res) {
  const campaign = await Campaign.findById(req.query.campaignId).setOptions({ skipTenantScope: true });
  const r = new twilio.twiml.VoiceResponse();
  if (!campaign) { r.say('Connecting'); return res.type('text/xml').send(r.toString()); }
  const text = (await localized.render({ accountId: campaign.accountId, channel: 'whisper', key: campaign.whisperTemplateKey, locale: 'en', vars: { campaign: campaign.name } })) || `Call from ${campaign.name}`;
  r.say(text);
  res.type('text/xml').send(r.toString());
}

async function _handleIvr(req, res) {
  const forward = req.query.forward;
  const r = new twilio.twiml.VoiceResponse();
  const digit = req.body.Digits;
  if (digit && forward) {
    const dial = r.dial({ answerOnBridge: true });
    dial.number(forward);
  } else {
    r.say('Goodbye.');
  }
  res.type('text/xml').send(r.toString());
}

// ---------------------------------------------------------------------------
// Billing helper (provider-agnostic via pricing dispatcher)
// ---------------------------------------------------------------------------

async function _chargeCall(call) {
  if (!call || !call.accountId) return;
  if (call.chargedCredits && call.chargedCredits > 0) return; // idempotent
  const billedSeconds = Math.max(0, parseInt(call.duration, 10) || 0);
  if (billedSeconds <= 0) return;

  const num = await PhoneNumber.findOne({ _id: call.phoneNumberId }).setOptions({ skipTenantScope: true });
  if (!num) {
    log.warn({ callId: String(call._id) }, 'cannot charge call: phone number not found');
    return;
  }

  let ratePerMinuteUsd = 0;
  let providerRateRef = null;
  try {
    const voice = await pricing.getVoicePrice({ phoneNumber: num });
    ratePerMinuteUsd = Number(voice.perMinuteUsd) || 0;
    providerRateRef = voice.rateRef || null;
  } catch (e) {
    log.warn({ err: e.message, callId: String(call._id) }, 'getVoicePrice failed; defaulting to 0.0085 USD/min');
    ratePerMinuteUsd = 0.0085;
  }

  const providerCostUsd = ratePerMinuteUsd * (billedSeconds / 60);
  const quote = await billing.computeCredits({
    providerCredentialId: num.providerCredentialId,
    accountId: call.accountId,
    kind: 'callPerMinute',
    providerCostUsd,
  });

  call.billedSeconds = billedSeconds;
  call.providerCostUsd = providerCostUsd;
  call.chargedCredits = quote.credits;
  await call.save();

  try {
    await billing.debit(call.accountId, quote.credits, {
      kind: 'call_charge',
      ref: { callId: call._id, providerCredentialId: num.providerCredentialId, phoneNumberId: num._id },
      metadata: {
        providerCostUsd,
        marginMode: quote.marginMode,
        marginValue: quote.marginValue,
        durationSec: billedSeconds,
        country: num.countryCode || '',
        providerRateRef,
      },
    });
  } catch (e) {
    if (e && e.code === 'INSUFFICIENT_CREDITS') {
      log.warn({ callId: String(call._id), needed: e.needed, balance: e.balance }, 'call_charge skipped: insufficient credits');
      await billing.noteZero(call.accountId, {
        kind: 'adjustment',
        ref: { callId: call._id, providerCredentialId: num.providerCredentialId, phoneNumberId: num._id },
        metadata: {
          providerCostUsd,
          marginMode: quote.marginMode,
          marginValue: quote.marginValue,
          durationSec: billedSeconds,
          providerRateRef,
          note: `INSUFFICIENT_CREDITS for call_charge: needed ${e.needed}, had ${e.balance}`,
        },
      });
    } else {
      log.error({ err: e.message, callId: String(call._id) }, 'call_charge debit failed');
    }
  }
}

// ---------------------------------------------------------------------------
// Shared status / recording handlers
// ---------------------------------------------------------------------------

async function _handleStatus(req, res, _providerName) {
  const sid = req.body.CallSid;
  const status = req.body.CallStatus;
  const duration = parseInt(req.body.CallDuration || '0', 10);
  const call = await Call.findOne({ providerCallId: sid }).setOptions({ skipTenantScope: true });
  if (!call) return res.status(200).end();

  call.status = status;
  if (duration) call.duration = duration;
  if (status === 'completed') call.endTime = new Date();
  if (status === 'in-progress' && !call.answerTime) call.answerTime = new Date();

  const campaign = call.campaignId ? await Campaign.findOne({ _id: call.campaignId }).setOptions({ skipTenantScope: true }) : null;
  const qualifiedThreshold = (campaign && campaign.qualifiedSeconds) || 60;
  if (call.duration >= qualifiedThreshold) {
    call.qualified = true;
    if (!call.score) call.score = 50;
  }

  await call.save();

  if (status === 'completed') {
    try {
      await _chargeCall(call);
    } catch (e) {
      log.error({ err: e.message, callId: String(call._id) }, 'chargeCall threw');
    }
  }

  if (campaign && campaign.postbackConfigs && status === 'completed') {
    for (const pb of campaign.postbackConfigs) {
      if (!pb.enabled) continue;
      const triggers = pb.triggers || [];
      const payload = {
        callerNumber: call.callerNumber,
        destinationNumber: call.destinationNumber,
        duration: call.duration,
        callId: String(call._id),
        providerCallId: call.providerCallId,
        status: call.status,
      };
      if (triggers.includes('call_completed')) {
        await dispatchPostback({ accountId: call.accountId, campaignId: campaign._id, callId: call._id, postback: pb, trigger: 'call_completed', payload });
      }
      if (triggers.includes('call_qualified') && call.qualified) {
        await dispatchPostback({ accountId: call.accountId, campaignId: campaign._id, callId: call._id, postback: pb, trigger: 'call_qualified', payload });
      }
    }
  }
  res.status(200).end();
}

async function _handleRecording(req, res, _providerName) {
  const callId = req.query.callId;
  // Telnyx mirrors RecordingUrl in TeXML callbacks. recording_urls.mp3 only
  // appears in native (non-TeXML) Call Control payloads, so RecordingUrl is
  // sufficient here.
  const recordingUrl = req.body.RecordingUrl;
  const recordingDuration = parseInt(req.body.RecordingDuration || '0', 10);
  const call = await Call.findOne({ _id: callId }).setOptions({ skipTenantScope: true });
  if (call && recordingUrl) {
    call.recordingUrl = recordingUrl + '.mp3';
    call.recordingDurationSec = recordingDuration;
    await call.save();
  }
  res.status(200).end();
}

// ---------------------------------------------------------------------------
// Routes — Twilio
// ---------------------------------------------------------------------------

router.post('/twilio/voice', verifyTwilio, (req, res, next) => _handleVoiceInbound(req, res, 'twilio').catch(next));
router.post('/twilio/whisper', (req, res, next) => _handleWhisper(req, res).catch(next));
router.post('/twilio/ivr', (req, res, next) => _handleIvr(req, res).catch(next));
router.post('/twilio/status', verifyTwilio, (req, res, next) => _handleStatus(req, res, 'twilio').catch(next));
router.post('/twilio/recording', verifyTwilio, (req, res, next) => _handleRecording(req, res, 'twilio').catch(next));

// ---------------------------------------------------------------------------
// Routes — Telnyx (TeXML)
// ---------------------------------------------------------------------------

router.post('/telnyx/voice', verifyTelnyx, (req, res, next) => _handleVoiceInbound(req, res, 'telnyx').catch(next));
router.post('/telnyx/whisper', (req, res, next) => _handleWhisper(req, res).catch(next));
router.post('/telnyx/ivr', (req, res, next) => _handleIvr(req, res).catch(next));
router.post('/telnyx/status', verifyTelnyx, (req, res, next) => _handleStatus(req, res, 'telnyx').catch(next));
router.post('/telnyx/recording', verifyTelnyx, (req, res, next) => _handleRecording(req, res, 'telnyx').catch(next));

module.exports = router;
