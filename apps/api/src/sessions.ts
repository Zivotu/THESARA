import { promises as fs } from 'node:fs';
import { getConfig } from './config.js';
import * as repo from './sessionRepository.js';
export type { PinSession } from './sessionRepository.js';

const { PIN_SESSION_PATH } = getConfig();

let migration: Promise<void> | null = null;

async function migrate() {
  if (!migration) {
    migration = (async () => {
      try {
        const txt = await fs.readFile(PIN_SESSION_PATH, 'utf-8');
        const data = JSON.parse(txt) as Record<string, Record<string, repo.PinSession>>;
        for (const [appId, sessions] of Object.entries(data)) {
          for (const [sid, sess] of Object.entries(sessions)) {
            await repo.create(appId, sid, sess);
          }
        }
        await fs.rename(PIN_SESSION_PATH, `${PIN_SESSION_PATH}.bak`);
      } catch {
        // no legacy file; ignore
      }
    })();
  }
  return migration;
}

export async function cleanup(appId: string, ttlMs: number) {
  await migrate();
  return repo.cleanup(appId, ttlMs);
}

export async function count(appId: string): Promise<number> {
  await migrate();
  return repo.count(appId);
}

export async function create(appId: string, sessionId: string, sess: repo.PinSession) {
  await migrate();
  return repo.create(appId, sessionId, sess);
}

export async function get(appId: string, sessionId: string): Promise<repo.PinSession | undefined> {
  await migrate();
  return repo.get(appId, sessionId);
}

export async function update(
  appId: string,
  sessionId: string,
  patch: Partial<repo.PinSession>,
) {
  await migrate();
  return repo.update(appId, sessionId, patch);
}

export async function remove(appId: string, sessionId: string) {
  await migrate();
  return repo.remove(appId, sessionId);
}

export async function list(appId: string): Promise<Array<{ sessionId: string } & repo.PinSession>> {
  await migrate();
  return repo.list(appId);
}

export async function revoke(appId: string, sessionId: string) {
  await migrate();
  return repo.revoke(appId, sessionId);
}

export async function revokeAll(appId: string) {
  await migrate();
  return repo.revokeAll(appId);
}
