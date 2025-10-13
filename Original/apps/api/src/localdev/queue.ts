import { Queue } from 'bullmq';
import { REDIS_URL } from '../config.js';

export type LocalDevOwner = {
  uid: string;
  name?: string;
  handle?: string;
  email?: string;
  photo?: string;
};

export type EnqueueOpts = { allowScripts?: boolean; owner?: LocalDevOwner };

export function getConnection() {
  if (REDIS_URL) return { connection: { connectionString: REDIS_URL } } as const;
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = Number(process.env.REDIS_PORT || 6379);
  return { connection: { host, port } } as const;
}

export const devBuildQueue = new Queue('thesara-builds', getConnection());

export async function enqueueDevBuild(appId: string, zipPath: string, opts?: EnqueueOpts): Promise<string> {
  const job = await devBuildQueue.add(
    'build',
    { appId, zipPath, allowScripts: !!opts?.allowScripts, owner: opts?.owner },
    {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
      attempts: 1,
      timeout: Number(process.env.DEV_BUILD_TIMEOUT_MS || 15 * 60 * 1000),
    },
  );
  return job.id as string;
}
