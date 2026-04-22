'use strict';

const readline = require('readline');
const { connect } = require('../db/mongo');
const User = require('../models/User');
const log = require('../utils/logger');

function prompt(q, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      const stdin = process.openStdin();
      process.stdin.on('data', (char) => {
        const c = char.toString();
        if (c === '\n' || c === '\r' || c === '\u0004') process.stdin.pause();
        else process.stdout.write('\u001b[2K\u001b[200D' + q + Array(rl.line.length + 1).join('*'));
      });
    }
    rl.question(q, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

(async () => {
  await connect();
  const email = (process.argv[2] || (await prompt('Super-admin email: '))).toLowerCase();
  const name = process.argv[3] || (await prompt('Name: ')) || 'Super Admin';
  const password = process.argv[4] || (await prompt('Password (min 8): ', true));
  if (!email || !password || password.length < 8) {
    log.error('email and password (>=8) required');
    process.exit(1);
  }
  let u = await User.findOne({ email });
  if (u) {
    u.isSuperAdmin = true;
    if (password) u.passwordHash = await User.hashPassword(password);
    await u.save();
    log.info({ email }, 'existing user promoted to super-admin');
  } else {
    u = await User.create({ email, name, passwordHash: await User.hashPassword(password), isSuperAdmin: true });
    log.info({ email }, 'super-admin created');
  }
  process.exit(0);
})().catch((e) => { log.error(e); process.exit(1); });
