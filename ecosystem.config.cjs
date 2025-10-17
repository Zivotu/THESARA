// ecosystem.config.cjs  (u rootu repozitorija)
module.exports = {
  apps: [
    {
      name: 'thesara-api',
      cwd: '/srv/thesara/app/apps/api',
      // Kanonski start: node + dotenv preloader + OpenSSL legacy
      script: 'node',
      args: 'dist/index.js',
      node_args: '--openssl-legacy-provider -r dotenv/config',
      env: {
        NODE_ENV: 'production',
        PORT: 8788,
        DOTENV_CONFIG_PATH: '/srv/thesara/app/apps/api/.env.production',
        GOOGLE_APPLICATION_CREDENTIALS: '/etc/thesara/creds/firebase-sa.json',
      },
      max_memory_restart: '512M',
      restart_delay: 5000,
      time: true,
    },
    {
      name: 'thesara-web',
      cwd: '/srv/thesara/app/apps/web',
      // Držimo se skripti iz package.json-a
      script: 'pnpm',
      args: 'start',
      env_file: '/srv/thesara/app/apps/web/.env.production',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '512M',
      restart_delay: 5000,
      time: true,
    },
  ],
};
