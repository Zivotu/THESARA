// PM2 ecosystem configuration for Thesara
// Works both locally (Windows) and on Linux server
module.exports = {
  apps: [
    {
      name: 'thesara-api',
      cwd: '/srv/thesara/app/apps/api',
      script: 'node',
      args: '-r dotenv/config dist/server.cjs',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 8788,
        DOTENV_CONFIG_PATH: '/srv/thesara/app/apps/api/.env.production',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8788,
        DOTENV_CONFIG_PATH: '/srv/thesara/app/apps/api/.env.production',
      },
      max_memory_restart: '512M',
      restart_delay: 5000,
    },
    {
      name: 'thesara-web',
      cwd: '/srv/thesara/app/apps/web',
      script: 'pnpm',
      args: 'start',
      env: { NODE_ENV: 'production', PORT: 3000 },
      env_production: { NODE_ENV: 'production', PORT: 3000 },
      max_memory_restart: '512M',
      restart_delay: 5000,
    },
  ],
};
