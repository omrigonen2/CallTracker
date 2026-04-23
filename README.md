# CallTracker

Multi-tenant call tracking platform with pluggable telephony providers (Twilio, Telnyx). See [`docs/spec.md`](docs/spec.md) for the full specification.

## Features

- Multi-tenant SaaS isolation (every domain document scoped by `accountId`)
- Role-Based Access Control with system + custom roles, fine-grained per-resource permissions
- Software-managed provider credentials (Twilio, Telnyx) — encrypted in MongoDB, configured via Admin Console (no `.env` secrets)
- Internationalization with English (LTR) and Hebrew (RTL) parity
- Inbound call routing with time-based rules, optional whisper + IVR
- Recording, tagging, outcomes, notes, postbacks
- Postback dispatcher with retry & per-attempt logs
- Audit logging
- BullMQ workers for async work
- EJS UI with logical CSS properties for true RTL support

## Stack

Node.js 20+, Express, MongoDB (Mongoose), Redis (BullMQ + cache invalidation pub/sub), EJS, Twilio SDK, i18next, bcryptjs, jsonwebtoken.

## Quick start

### 1. Boot infrastructure

```
docker compose up -d mongo redis
```

### 2. Configure secrets

Copy `.env.example` to `.env` and set at minimum:

- `MASTER_ENCRYPTION_KEY` — 32-byte base64 key for encrypting provider credentials at rest. Generate with:

  ```
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```

- `JWT_SECRET` — long random string.

`MONGODB_URI` and `REDIS_URL` default to local docker.

> Telephony provider credentials (Twilio and Telnyx) are NOT in `.env`. They're configured via the Admin Console after bootstrap.

### 3. Install & seed

```
npm install
npm run seed                      # seeds system roles + localized templates
npm run bootstrap-admin <email> <name> <password>   # creates a super-admin
```

### 4. Run

```
npm run dev        # web server
npm run worker     # BullMQ workers (run in another shell)
```

Open http://localhost:3000.

### 5. Configure providers

1. Sign in as the super-admin.
2. Open `/admin/providers` → "New credential".
3. Pick a provider and paste its credentials (see "Telephony providers" below). Mark default.
4. Sign up a tenant account at `/auth/signup` (or invite users from `/admin/accounts`).
5. Buy numbers under the tenant account at `/numbers/buy`.

## Telephony providers

The Admin Console can manage multiple credentials per provider. Each
account selects a primary credential and optionally a fallback; the
fallback is used automatically when number search or purchase fails on
the primary.

### Twilio

1. Open the Twilio Console → **Account → API keys & tokens**.
2. Copy the **Account SID** and **Auth Token**. Optionally also copy a
   restricted **API Key + API Secret** and a request-validation
   **Signing secret** (used for webhook signature verification).
3. Paste the values into `/admin/providers/new` with provider = Twilio.

### Telnyx

1. Sign in to the [Telnyx Portal](https://portal.telnyx.com/).
2. **API Key** — go to **Account → API Keys**, generate a v2 API key.
3. **Public Key** — go to **Account → Public Key**. Copy the base64
   Ed25519 public key. Webhook signatures (`Telnyx-Signature-Ed25519`
   header) are verified with this key.
4. **TeXML Application** — leave blank. CallTracker auto-creates a
   "CallTracker (auto)" TeXML Application the first time you buy a
   number with this credential, and persists its id back on the
   credential record so subsequent purchases reuse the same application.
5. Paste API key + public key into `/admin/providers/new` with
   provider = Telnyx.

The same admin form lets you set per-provider profit margins for
number purchases, monthly fees, and per-minute call charges, with
optional overrides per account.

## Tests

```
npm test                       # smoke tests (async context, RBAC, crypto, routing)
npm run check-translations     # CI gate: locale completeness
```

## Architecture

See `docs/spec.md` Section 4 (Architecture diagram) and Section 11 (Provider Layer / CredentialStore).

Key flow for an inbound call:

```
Provider webhook → /webhooks/{twilio|telnyx}/voice
  → verify signature (HMAC-SHA1 for Twilio, Ed25519 for Telnyx)
  → resolve PhoneNumber by To → resolve Account & Campaign
  → time-based routing → TwiML/TeXML response (Dial + optional whisper/record)
  → background: postback dispatch (call_started)

Provider status → /webhooks/{twilio|telnyx}/status
  → update Call.status/duration → mark qualified if duration ≥ threshold
  → charge credits via pricing dispatcher (live for Twilio,
    stored per-minute rate for Telnyx)
  → background: postback dispatch (call_completed / call_qualified)
```

## Project layout

```
src/
  app.js                  Express app composition
  server.js               Entrypoint
  config/                 Env loader, AES-256-GCM crypto helper
  db/                     Mongo + Redis connectors
  models/                 Mongoose models + tenantScope plugin
  services/               Domain services (CredentialStore, RBAC, providers, routing, postbacks)
  middleware/             Auth, RBAC, i18n, errors, flash
  routes/                 Express routers (auth, account, users, roles, campaigns, numbers, calls, postbacks, analytics, admin, webhooks)
  workers/                BullMQ workers (postbacks, emails)
  views/                  EJS templates
  seeds/                  System role + super-admin bootstrap
locales/                  i18n JSON namespaces (en, he)
public/                   Static assets (CSS)
tests/                    node:test smoke tests
scripts/                  CI scripts (translation completeness)
```
