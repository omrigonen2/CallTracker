'use strict';

const twilioPricing = require('./twilioPricing');
const telnyxPricing = require('./telnyxPricing');

/**
 * Provider-agnostic monthly per-number USD price.
 * Dispatches to the underlying provider's pricing module.
 */
async function getNumberMonthlyPriceUsd({
  provider, credentialId = null, countryCode, numberType = 'local', phoneNumber = null,
}) {
  if (provider === 'twilio') {
    return twilioPricing.getNumberMonthlyPriceUsd({ credentialId, countryCode, numberType });
  }
  if (provider === 'telnyx') {
    return telnyxPricing.getNumberMonthlyPriceUsd({ credentialId, countryCode, numberType, phoneNumber });
  }
  throw new Error(`pricing.getNumberMonthlyPriceUsd: unknown provider "${provider}"`);
}

/**
 * Provider-agnostic per-minute USD inbound voice price.
 *
 * Twilio exposes a live Pricing API per destination number.
 * Telnyx has no equivalent live API — we stash the per-minute rate on
 * `PhoneNumber.inboundPricePerMinUsd` at purchase time and read it here.
 *
 * Returns `{ perMinuteUsd, rateRef }`.
 */
async function getVoicePrice({ phoneNumber: phoneNumberDoc }) {
  if (!phoneNumberDoc) throw new Error('pricing.getVoicePrice: phoneNumber doc required');
  const provider = phoneNumberDoc.provider;

  if (provider === 'twilio') {
    const r = await twilioPricing.getVoicePrice({
      credentialId: phoneNumberDoc.providerCredentialId,
      destinationE164: phoneNumberDoc.phoneNumber,
    });
    return {
      perMinuteUsd: Number(r.inboundCallPriceUsd) || 0,
      rateRef: r.country ? `twilio:${r.country}` : 'twilio:unknown',
    };
  }

  if (provider === 'telnyx') {
    const rate = phoneNumberDoc.inboundPricePerMinUsd;
    if (rate == null || !Number.isFinite(rate)) {
      throw new Error('telnyx number missing stored inboundPricePerMinUsd');
    }
    return { perMinuteUsd: rate, rateRef: 'telnyx:stored' };
  }

  throw new Error(`pricing.getVoicePrice: unknown provider "${provider}"`);
}

module.exports = { getNumberMonthlyPriceUsd, getVoicePrice };
