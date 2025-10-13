if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';
if (!process.env.NEXT_DISABLE_SWC_WASM) process.env.NEXT_DISABLE_SWC_WASM = '1';
require('./.next/standalone/apps/web/server.js');

