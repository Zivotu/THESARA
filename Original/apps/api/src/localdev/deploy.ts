import path from 'node:path';
import { copyDirAtomic } from './fs.js';
import { getLocalDevConfig } from './env.js';

export async function deployDist(appId: string, distPath: string): Promise<string> {
  const { hostedAppsDir } = getLocalDevConfig();
  const target = path.join(hostedAppsDir, appId, 'dist');
  await copyDirAtomic(distPath, target);
  return target;
}

