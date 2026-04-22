'use strict';

const express = require('express');
const twilio = require('twilio');
const PhoneNumber = require('../models/PhoneNumber');
const Call = require('../models/Call');
const Campaign = require('../models/Campaign');
const CallerProfile = require('../models/CallerProfile');
const credentialStore = require('../services/credentialStore');
const { resolveForwardTo } = require('../services/routing');
const { dispatch: dispatchPostback } = require('../services/postbackDispatcher');
const localized = require('../services/localizedContent');
const config = require('../config');
const log = require('../utils/logger');

const router = express.Router();

// Webhooks are PUBLIC: tenant is resolved by the called number.
// We bypass tenant scoping by NOT being inside a per-account async context.

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

router.post('/twilio/voice', verifyTwilio, async (req, res, next) => {
  try {
    const to = req.body.To;
    const from = req.body.From;
    const callSid = req.body.CallSid;
    // Bypass tenant scope for cross-tenant lookup by exact phoneNumber:
    const num = await PhoneNumber.findOne({ phoneNumber: to }).setOptions({ skipTenantScope: true });
    if (!num) {
      const r = new twilio.twiml.VoiceResponse();
      r.say('This number is not configured.');
      return res.type('text/xml').send(r.toString());
    }

    const campaign = num.campaignId ? await Campaign.findOne({ _id: num.campaignId }).setOptions({ skipTenantScope: true }) : null;

    // Blacklist check
    const profile = await CallerProfile.findOne({ accountId: num.accountId, phoneNumber: from }).setOptions({ skipTenantScope: true });
    if (profile && profile.isBlacklisted) {
      const r = new twilio.twiml.VoiceResponse();
      r.reject();
      return res.type('text/xml').send(r.toString());
    }

    const { forwardTo, fallbackTo } = resolveForwardTo({ phoneNumberDoc: num, campaignDoc: campaign });

    // Create call record
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

    // Update profile
    await CallerProfile.findOneAndUpdate(
      { accountId: num.accountId, phoneNumber: from },
      { $inc: { totalCalls: 1 }, $set: { lastCallAt: new Date() }, $setOnInsert: { accountId: num.accountId, phoneNumber: from } },
      { upsert: true, setDefaultsOnInsert: true, ...{ skipTenantScope: true } }
    ).setOptions({ skipTenantScope: true });

    // Fire call_started postbacks
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

    // Optional IVR
    if (campaign && campaign.ivrEnabled) {
      const locale = campaign && campaign.timezone ? 'en' : 'en';
      const prompt = (await localized.render({ accountId: num.accountId, channel: 'ivr', key: campaign.ivrTemplateKey, locale, vars: { campaign: campaign.name } })) || 'Press 1 for sales, 2 for support.';
      const gather = r.gather({ numDigits: 1, action: `${config.baseUrl}/webhooks/twilio/ivr?callId=${call._id}&forward=${encodeURIComponent(forwardTo)}`, method: 'POST' });
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
    if (campaign && campaign.recordCalls) dialOpts.recordingStatusCallback = `${config.baseUrl}/webhooks/twilio/recording?callId=${call._id}`;
    const dial = r.dial(dialOpts);

    if (campaign && campaign.whisperEnabled) {
      dial.number({ url: `${config.baseUrl}/webhooks/twilio/whisper?campaignId=${campaign._id}` }, forwardTo);
    } else {
      dial.number(forwardTo);
    }
    if (fallbackTo) dial.number(fallbackTo);

    res.type('text/xml').send(r.toString());
  } catch (e) { next(e); }
});

router.post('/twilio/whisper', async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.query.campaignId).setOptions({ skipTenantScope: true });
    const r = new twilio.twiml.VoiceResponse();
    if (!campaign) { r.say('Connecting'); return res.type('text/xml').send(r.toString()); }
    const text = (await localized.render({ accountId: campaign.accountId, channel: 'whisper', key: campaign.whisperTemplateKey, locale: 'en', vars: { campaign: campaign.name } })) || `Call from ${campaign.name}`;
    r.say(text);
    res.type('text/xml').send(r.toString());
  } catch (e) { next(e); }
});

router.post('/twilio/ivr', async (req, res, next) => {
  try {
    const callId = req.query.callId;
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
  } catch (e) { next(e); }
});

router.post('/twilio/status', verifyTwilio, async (req, res, next) => {
  try {
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
  } catch (e) { next(e); }
});

router.post('/twilio/recording', verifyTwilio, async (req, res, next) => {
  try {
    const callId = req.query.callId;
    const recordingUrl = req.body.RecordingUrl;
    const recordingDuration = parseInt(req.body.RecordingDuration || '0', 10);
    const call = await Call.findOne({ _id: callId }).setOptions({ skipTenantScope: true });
    if (call) {
      call.recordingUrl = recordingUrl + '.mp3';
      call.recordingDurationSec = recordingDuration;
      await call.save();
    }
    res.status(200).end();
  } catch (e) { next(e); }
});

module.exports = router;
