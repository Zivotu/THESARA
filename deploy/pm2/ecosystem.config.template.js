/**
 * PM2 template aligned with thesara.space production layout.
 * Copy to ecosystem.config.js on the server and adjust secrets as needed.
 */
module.exports = {
  apps: [
    {
      name: 'thesara-api',
      cwd: '/srv/thesara/app/apps/api',
      script: 'bash',
      // IMPORTANT: --openssl-legacy-provider is added to the node command.
      // This is required for Node.js v17+ to support legacy RSA keys used by Firebase/Google Auth.
      // The project's package.json specifies "node": ">=20", so this should be correct.
      // If your production server runs an older Node version (<17), this flag will cause a crash.
      // In that case, remove --openssl-legacy-provider from the command.
      args: '-c "export GOOGLE_APPLICATION_CREDENTIALS=/etc/thesara/creds/firebase-sa.json && node --openssl-legacy-provider dist/server.cjs"',
      env_file: '/srv/thesara/app/apps/api/.env.production',
      env: {
        NODE_ENV: 'production',
        PORT: '8788',
        CREATEX_WORKER_ENABLED: 'true',
        ALLOWED_ORIGINS: 'https://thesara.space,https://www.thesara.space',
        STRIPE_SUCCESS_URL: 'https://thesara.space/billing/success',
        STRIPE_CANCEL_URL: 'https://thesara.space/billing/cancel',
        DOTENV_CONFIG_PATH: '/srv/thesara/app/apps/api/.env.production',
      },
      max_memory_restart: '512M',
      min_uptime: '30s',
      restart_delay: 5000,
    },
    {
      name: 'thesara-web',
      cwd: '/srv/thesara/app/apps/web',
      script: 'pnpm',
      args: 'start',
      env_file: '/srv/thesara/app/apps/web/.env.production',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
      max_memory_restart: '512M',
      min_uptime: '30s',
      restart_delay: 5000,
      watch: false,
      autorestart: false, // Enable when ready to keep Next.js running via PM2.
    },
  ],
};
