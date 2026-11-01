'use strict';

const path = require('node:path');
const { createApp } = require('./src/app');
const { demoConfig } = require('./src/demo');
const { createHub } = require('./src/hub');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const HUB = process.env.HUB_MODE === 'true';
const demo = HUB ? null : demoConfig();

// Agency mode: one server, many independent gyms (see README → Agency mode).
const describe = (store) => {
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const recent = store.checkins.filter((c) => c.ok && c.date >= since);
  const last = store.checkins.length ? store.checkins[store.checkins.length - 1].createdAt : '';
  return { name: store.settings.name, logo: store.settings.logo, color: store.settings.color, count30: recent.length, last };
};

const app = HUB
  ? createHub({
      dataDir: DATA_DIR,
      createApp,
      appName: 'Nadi',
      metric: 'members',
      describe,
      baseDomain: process.env.BASE_DOMAIN,
      hubDomain: process.env.HUB_DOMAIN,
      setupCode: process.env.SETUP_CODE || '',
      publicDir: path.join(__dirname, 'public'),
    })
  : createApp({ dataDir: DATA_DIR, setupCode: process.env.SETUP_CODE || '', demo });

const server = app.listen(PORT, HOST, () => {
  console.log(`💪 Nadi is running on http://localhost:${PORT}${HUB ? '/hub (agency mode)' : ''}`);
  console.log(`   Data directory: ${DATA_DIR}`);
  if (demo) console.log(`   DEMO MODE: password "${demo.password}", resets every ${demo.resetMinutes} min`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (HUB) app.locals.flushAll();
    else app.locals.store.flushStats();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
