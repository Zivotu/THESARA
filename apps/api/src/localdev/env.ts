import path from 'node:path';
const PKG_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '../..');

export type BuildMode = 'native' | 'docker';

export function getLocalDevConfig() {
  const THESARA_ENV = process.env.THESARA_ENV || 'local';
  const storageRoot = path.resolve(
    REPO_ROOT,
    process.env.THESARA_STORAGE_ROOT || './.devdata',
  );
  const uploadsDir = path.join(storageRoot, 'uploads');
  const buildTmpDir = path.join(storageRoot, 'build-tmp');
  const hostedAppsDir = path.join(storageRoot, 'hosted-apps');
  const logsDir = path.join(storageRoot, 'logs');

  const DEV_BUILD_MODE = (process.env.DEV_BUILD_MODE || 'native') as BuildMode;
  const DEV_BUILD_TIMEOUT_MS = Number(process.env.DEV_BUILD_TIMEOUT_MS || 15 * 60 * 1000);
  const DEV_LOG_TAIL_LINES = Number(process.env.DEV_LOG_TAIL_LINES || 200);
  const DEV_QUEUE_CONCURRENCY = Number(process.env.DEV_QUEUE_CONCURRENCY || 1);
  const DEV_ALLOW_SCRIPTS = (process.env.DEV_ALLOW_SCRIPTS || '0') === '1';
  const THESARA_PUBLIC_BASE = process.env.THESARA_PUBLIC_BASE || 'http://localhost:8788';

  return {
    THESARA_ENV,
    storageRoot,
    uploadsDir,
    buildTmpDir,
    hostedAppsDir,
    logsDir,
    DEV_BUILD_MODE,
    DEV_BUILD_TIMEOUT_MS,
    DEV_LOG_TAIL_LINES,
    DEV_QUEUE_CONCURRENCY,
    DEV_ALLOW_SCRIPTS,
    THESARA_PUBLIC_BASE,
  };
}

