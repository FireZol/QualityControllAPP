'use strict';
// Entry point: node app/server.js
const { loadConfig } = require('./lib/config');
const { createApp } = require('./app');

(async () => {
  const config = loadConfig();
  const app = await createApp(config);
  await app.start();
  const a = app.address;
  console.log(`ROMCAB CTC pornit pe http://${a.address === '0.0.0.0' || a.address === '::' ? 'localhost' : a.address}:${a.port}/ (folder date: ${config.dataDir})`);
  const stop = async () => { console.log('Oprire…'); await app.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch((e) => {
  console.error('Pornirea a eșuat:', e.message);
  process.exit(1);
});
