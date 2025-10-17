// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'thesara-api',
      cwd: 'apps/api',
      script: 'node',
      args: 'dist/server.cjs',
      node_args: '-r dotenv/config',
      env: {
        NODE_ENV: 'production',
        PORT: 8788,
        DOTENV_CONFIG_PATH: 'apps/api/.env.production',
        GOOGLE_APPLICATION_CREDENTIALS: '/etc/thesara/creds/firebase-sa.json',
      },
      max_memory_restart: '512M',
      restart_delay: 5000,
    },
    {
      name: 'thesara-web',
      cwd: 'apps/web',
      script: 'pnpm',
      args: 'start',
      env_file: 'apps/web/.env.production',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '512M',
      restart_delay: 5000,
    },
  ],
};