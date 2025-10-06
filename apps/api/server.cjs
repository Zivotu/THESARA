// Passenger-friendly bootstrapper for the API (Fastify, ESM output)
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

const path = require('node:path');

(async () => {
  const entry = path.resolve(__dirname, './dist/server.mjs');
  await import('file://' + entry);
})();

