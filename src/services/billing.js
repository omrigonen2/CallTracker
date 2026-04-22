'use strict';

const Account = require('../models/Account');
const ProviderCredential = require('../models/ProviderCredential');
const LedgerEntry = require('../models/LedgerEntry');
const config = require('../config');
const log = require('../utils/logger');

const MARGIN_KINDS = ['numberPurchase', 'numberMonthly', 'callPerMinute'];

class InsufficientCreditsError extends Error {
  constructor(needed, balance) {
    super('INSUFFICIENT_CREDITS');
    this.code = 'INSUFFICIENT_CREDITS';
    this.needed = needed;
    this.balance = balance;
  }
}

function applyMargin(usd, mode, value) {
  if (!Number.isFinite(usd) || usd < 0) usd = 0;
  if (!Number.isFinite(value) || value < 0) value = 0;
  if (mode === 'fixed') return usd + value;
  // percent: value is e.g. 25 → +25%
  return usd * (1 + value / 100);
}

function usdToCredits(usd) {
  const rate = Number(config.creditUsdRate) || 0.01;
  if (rate <= 0) return Math.ceil(usd);
  return Math.ceil(usd / rate);
}

/**
 * Compute the price in credits for an item:
 *   1. Start from raw provider USD cost.
 *   2. Apply provider's default margin for `kind`.
 *   3. If the account has an enabled override for `kind`, apply it INSTEAD
 *      of the provider default (override is the final word).
 *   4. Convert USD → credits via CREDIT_USD_RATE and round up.
 *
 * Returns { credits, marginMode, marginValue, finalUsd }.
 */
async function computeCredits({ providerCredentialId, accountId, kind, providerCostUsd }) {
  if (!MARGIN_KINDS.includes(kind)) {
    throw new Error(`computeCredits: unknown margin kind "${kind}"`);
  }
  const usdIn = Number(providerCostUsd) || 0;

  let marginMode = 'percent';
  let marginValue = 0;

  if (providerCredentialId) {
    const cred = await ProviderCredential.findById(providerCredentialId).lean();
    const m = cred && cred.margins && cred.margins[kind];
    if (m) {
      marginMode = m.mode || 'percent';
      marginValue = Number(m.value) || 0;
    }
  }

  if (accountId) {
    const acc = await Account.findById(accountId).lean();
    const ov = acc && acc.providers && acc.providers.marginOverride && acc.providers.marginOverride[kind];
    if (ov && ov.enabled) {
      marginMode = ov.mode || 'percent';
      marginValue = Number(ov.value) || 0;
    }
  }

  const finalUsd = applyMargin(usdIn, marginMode, marginValue);
  const credits = usdToCredits(finalUsd);
  return { credits, marginMode, marginValue, finalUsd, providerCostUsd: usdIn };
}

async function getBalance(accountId) {
  const a = await Account.findById(accountId).select('credits').lean();
  return a ? Number(a.credits) || 0 : 0;
}

/**
 * Atomically debit credits from an account; throws INSUFFICIENT_CREDITS if the
 * balance is below `credits`. Appends a LedgerEntry for audit.
 *
 * `credits` must be a positive integer-like number.
 */
async function debit(accountId, credits, { kind, ref = {}, metadata = {}, createdBy = null } = {}) {
  if (!accountId) throw new Error('debit: accountId required');
  const amount = Math.ceil(Number(credits) || 0);
  if (amount <= 0) {
    return { balance: await getBalance(accountId), credits: 0, ledgerEntry: null };
  }

  const updated = await Account.findOneAndUpdate(
    { _id: accountId, credits: { $gte: amount } },
    { $inc: { credits: -amount } },
    { new: true }
  ).select('credits').lean();

  if (!updated) {
    const bal = await getBalance(accountId);
    throw new InsufficientCreditsError(amount, bal);
  }

  const entry = await LedgerEntry.create({
    accountId,
    kind,
    credits: -amount,
    balanceAfter: updated.credits,
    ref,
    metadata,
    createdBy,
  });

  return { balance: updated.credits, credits: amount, ledgerEntry: entry };
}

/**
 * Credit (add) credits to an account. No balance guard. Appends a LedgerEntry.
 */
async function credit(accountId, credits, { kind, ref = {}, metadata = {}, createdBy = null } = {}) {
  if (!accountId) throw new Error('credit: accountId required');
  const amount = Math.ceil(Number(credits) || 0);
  if (amount <= 0) {
    return { balance: await getBalance(accountId), credits: 0, ledgerEntry: null };
  }

  const updated = await Account.findOneAndUpdate(
    { _id: accountId },
    { $inc: { credits: amount } },
    { new: true }
  ).select('credits').lean();

  if (!updated) throw new Error('credit: account not found');

  const entry = await LedgerEntry.create({
    accountId,
    kind,
    credits: amount,
    balanceAfter: updated.credits,
    ref,
    metadata,
    createdBy,
  });

  return { balance: updated.credits, credits: amount, ledgerEntry: entry };
}

/**
 * Best-effort note: write a zero-credit LedgerEntry for visibility (used when
 * a call_charge would have failed insufficient-credits but we don't want to
 * block the flow).
 */
async function noteZero(accountId, { kind, ref = {}, metadata = {} } = {}) {
  try {
    const bal = await getBalance(accountId);
    return await LedgerEntry.create({
      accountId,
      kind,
      credits: 0,
      balanceAfter: bal,
      ref,
      metadata,
    });
  } catch (e) {
    log.warn({ err: e.message }, 'noteZero ledger write failed');
    return null;
  }
}

module.exports = {
  MARGIN_KINDS,
  InsufficientCreditsError,
  applyMargin,
  usdToCredits,
  computeCredits,
  getBalance,
  debit,
  credit,
  noteZero,
};
