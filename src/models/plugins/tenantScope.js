'use strict';

const ctx = require('../../utils/asyncContext');

/**
 * Adds `accountId` to the schema (required by default) and auto-injects an
 * `{accountId}` filter on find/update/delete when an account is in the
 * async-local-storage context. Controllers must NEVER take accountId from the
 * request body or query.
 *
 * Pass `{ optional: true }` for collections that may legitimately have null
 * accountId (e.g. system-scoped Roles, system LocalizedTemplates).
 *
 * Pass `{ skip: true }` to opt out (e.g. global User, Account, ProviderCredential).
 */
function tenantScopePlugin(schema, options = {}) {
  if (options.skip) return;

  const accountIdRequired = !options.optional;

  schema.add({
    accountId: {
      type: require('mongoose').Schema.Types.ObjectId,
      ref: 'Account',
      required: accountIdRequired,
      index: true,
    },
  });

  // Mongoose 9 dropped callback-style document middleware. All hooks below use
  // the promise-style signature (no `next` argument) and rely on `this` for the
  // doc/query.

  function applyScope() {
    const accountId = ctx.getAccountId();
    if (!accountId) return; // no scope active (e.g. seeders, super-admin queries)
    const filter = this.getFilter();
    if (filter.accountId === undefined) {
      this.where({ accountId });
    }
  }

  ['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'count', 'countDocuments', 'updateMany', 'updateOne', 'deleteMany', 'deleteOne'].forEach((hook) => {
    schema.pre(hook, applyScope);
  });

  // Inject accountId from the async-local context BEFORE validation runs,
  // otherwise the required-field validator rejects new documents before the
  // save hook ever fires.
  function injectAccountId() {
    if (!this.accountId) {
      const accountId = ctx.getAccountId();
      if (accountId) this.accountId = accountId;
    }
  }
  schema.pre('validate', injectAccountId);
  schema.pre('save', injectAccountId);

  // Model.insertMany() bypasses pre('save'); inject during pre('insertMany').
  // The insertMany hook receives the docs array as the first argument under
  // the promise-style signature.
  schema.pre('insertMany', function preInsertMany(docs) {
    const accountId = ctx.getAccountId();
    if (accountId && Array.isArray(docs)) {
      docs.forEach((d) => { if (d && !d.accountId) d.accountId = accountId; });
    }
  });
}

module.exports = tenantScopePlugin;
