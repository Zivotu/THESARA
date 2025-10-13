import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Queue, Worker } from 'bullmq';
import { initBuild, updateBuild } from '../models/Build.js';
import { getBuildDir } from '../paths.js';
import { REDIS_URL } from '../config.js';
import { readApps, writeApps } from '../db.js';

const QUEUE_NAME = 'createx-build';

export type BuildWorkerHandle = { close: () => Promise<void> };

export class QueueDisabledError extends Error {
  code = 'QUEUE_DISABLED';
  constructor(message = 'Build queue is disabled') {
    super(message);
    this.name = 'QueueDisabledError';
  }
}

type RedisConnection =
  | { connectionString: string }
  | { host: string; port: number };

let queueConnection: RedisConnection | null = null;
let createxBuildQueue: Queue | null = null;

function resolveRedisConnection(): RedisConnection | null {
  if (REDIS_URL) {
    return { connectionString: REDIS_URL };
  }
  const host = process.env.REDIS_HOST;
  if (host) {
    return {
      host,
      port: Number(process.env.REDIS_PORT || 6379),
    };
  }
  return null;
}

function ensureQueue(): Queue | null {
  if (!queueConnection) {
    queueConnection = resolveRedisConnection();
  }
  if (!queueConnection) return null;
  if (!createxBuildQueue) {
    createxBuildQueue = new Queue(QUEUE_NAME, { connection: queueConnection });
  }
  return createxBuildQueue;
}

function queueDisabled(): QueueDisabledError {
  return new QueueDisabledError();
}

function createNoopHandle(): BuildWorkerHandle {
  return { close: async () => {} };
}

function logState(id: string, state: string) {
  const payload = { id, state };
  if (state === 'failed') console.error(payload, 'build:state');
  else console.info(payload, 'build:state');
}

async function ensureStorageCapabilityFlag(buildId: string): Promise<void> {
  try {
    const apps = await readApps();
    const idx = apps.findIndex(
      (app: any) => app?.pendingBuildId === buildId || app?.buildId === buildId,
    );
    if (idx < 0) return;
    const current = apps[idx] as any;
    const capabilities = { ...(current.capabilities || {}) };
    const features = new Set<string>(
      Array.isArray(capabilities.features) ? capabilities.features : [],
    );
    const hasStorageEnabled = capabilities.storage?.enabled === true;
    if (!hasStorageEnabled && !features.has('storage')) {
      return;
    }
    let changed = false;
    if (!hasStorageEnabled) {
      capabilities.storage = { ...(capabilities.storage || {}), enabled: true };
      changed = true;
    }
    if (!features.has('storage')) {
      features.add('storage');
      changed = true;
    }
    if (!changed) return;
    capabilities.features = Array.from(features);
    apps[idx] = {
      ...current,
      capabilities,
      updatedAt: Date.now(),
    };
    await writeApps(apps as any);
  } catch (err) {
    console.warn({ buildId, err }, 'storage_capability_update_failed');
  }
}

export async function enqueueCreatexBuild(buildId: string = randomUUID()): Promise<string> {
  if (process.env.CREATEX_WORKER_ENABLED !== 'true') {
    throw queueDisabled();
  }
  const queue = ensureQueue();
  if (!queue) {
    throw queueDisabled();
  }
  await initBuild(buildId);
  await queue.add('build', { buildId });
  return buildId;
}

export function startCreatexBuildWorker(): BuildWorkerHandle {
  if (process.env.CREATEX_WORKER_ENABLED !== 'true') {
    return createNoopHandle();
  }
  queueConnection = resolveRedisConnection();
  if (!queueConnection) {
    console.warn('[worker] REDIS_URL missing – build worker disabled');
    return createNoopHandle();
  }
  const queue = ensureQueue();
  if (!queue) {
    console.warn('[worker] Failed to initialise queue connection – build worker disabled');
    return createNoopHandle();
  }
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { buildId } = job.data as { buildId: string };
      try {
        await updateBuild(buildId, { state: 'build', progress: 0 });
        logState(buildId, 'build');
        await runBuildProcess(buildId);
        await ensureStorageCapabilityFlag(buildId);
        // Hand off to review queue; admin can approve to move to published
        await updateBuild(buildId, { state: 'pending_review', progress: 100 });
        logState(buildId, 'pending_review');
      } catch (err: any) {
        console.error({ buildId, err }, 'build:error');
        await updateBuild(buildId, {
          state: 'failed',
          progress: 100,
          error: err?.message,
        });
        logState(buildId, 'failed');
      }
    },
    { connection: queueConnection },
  );
  return {
    async close() {
      await worker.close();
      if (createxBuildQueue) {
        await createxBuildQueue.close();
        createxBuildQueue = null;
      }
      queueConnection = null;
    },
  };
}

async function runBuildProcess(buildId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const pkgMgr = process.env.npm_execpath || 'npm';
    const proc = spawn(pkgMgr, ['run', 'createx:build'], {
      env: { ...process.env, BUILD_ID: buildId },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      try {
        const dir = path.resolve('build', 'logs');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `${buildId}.log`), stdout + stderr);
      } catch (err) {
        console.error(err, 'build:log_error');
      }
      if (code === 0) resolve();
      else {
        if (stderr) console.error(stderr);
        reject(new Error(`exit_code_${code}`));
      }
    });
  });

  const src = path.resolve('build');
  const dest = path.join(getBuildDir(buildId), 'build');
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  await fs.cp(src, dest, { recursive: true });
  await fs.rm(src, { recursive: true, force: true });
}
