'use strict';

const { connect } = require('../db/mongo');
const { seedSystemRoles } = require('./roles');
const LocalizedTemplate = require('../models/LocalizedTemplate');
const SystemSetting = require('../models/SystemSetting');
const log = require('../utils/logger');

const SYSTEM_TEMPLATES = [
  { channel: 'whisper', key: 'campaign.whisper.default', en: 'Call from {{campaign}}', he: 'שיחה מקמפיין {{campaign}}' },
  { channel: 'ivr', key: 'campaign.ivr.default', en: 'Press 1 for sales, 2 for support.', he: 'הקש 1 למכירות, 2 לתמיכה.' },
  { channel: 'email', key: 'invitation.body', en: "You've been invited to {{account}}. Accept here: {{url}}", he: 'הוזמנת אל {{account}}. אישור כאן: {{url}}' },
];

async function seedTemplates() {
  for (const t of SYSTEM_TEMPLATES) {
    await LocalizedTemplate.findOneAndUpdate(
      { accountId: null, channel: t.channel, key: t.key },
      { $set: { translations: { en: t.en, he: t.he } } },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
  log.info({ count: SYSTEM_TEMPLATES.length }, 'system templates seeded');
}

(async () => {
  await connect();
  await seedSystemRoles();
  await seedTemplates();
  await SystemSetting.getOrCreate();
  log.info('system settings ensured');
  log.info('seed complete');
  process.exit(0);
})().catch((e) => { log.error(e); process.exit(1); });
