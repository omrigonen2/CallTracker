'use strict';

const Account = require('../models/Account');
const ProviderCredential = require('../models/ProviderCredential');

class NoPrimaryProviderError extends Error {
  constructor() {
    super('NO_PRIMARY_PROVIDER');
    this.code = 'NO_PRIMARY_PROVIDER';
  }
}

/**
 * Resolve { primary, fallback } credentials for an account.
 *
 * - If the account has explicit assignments, use them.
 * - Otherwise: fall back to the global default credential as primary; no fallback.
 * - Throws NoPrimaryProviderError if no primary can be resolved at all
 *   (no account assignment AND no global default).
 *
 * Returns plain objects with at minimum { _id, provider, label, margins }.
 */
async function getForAccount(accountId) {
  if (!accountId) throw new NoPrimaryProviderError();
  const acc = await Account.findById(accountId).select('providers').lean();
  let primary = null;
  let fallback = null;

  if (acc && acc.providers && acc.providers.primaryCredentialId) {
    primary = await ProviderCredential.findById(acc.providers.primaryCredentialId).lean();
  }
  if (acc && acc.providers && acc.providers.fallbackCredentialId) {
    fallback = await ProviderCredential.findById(acc.providers.fallbackCredentialId).lean();
  }

  if (!primary) {
    primary = await ProviderCredential.findOne({ isDefault: true }).lean();
    if (!primary) {
      primary = await ProviderCredential.findOne({}).sort({ createdAt: -1 }).lean();
    }
  }

  if (!primary) throw new NoPrimaryProviderError();
  if (fallback && String(fallback._id) === String(primary._id)) fallback = null;
  return { primary, fallback };
}

module.exports = { getForAccount, NoPrimaryProviderError };
