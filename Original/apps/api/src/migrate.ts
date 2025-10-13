import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writeApps,
  writeAppKv,
  setAppLike,
  writeEntitlements,
  writeCreators,
  readApps,
  readCreators,
  writeOglasi,
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

const LISTINGS_FILE = path.resolve(REPO_ROOT, 'storage', 'listings.json');
const KV_APPS_DIR = path.resolve(REPO_ROOT, 'storage', 'kv', 'apps');
const LIKES_DIR = path.resolve(REPO_ROOT, 'storage', 'kv', 'likes');
const ENTITLEMENTS_FILE = path.resolve(REPO_ROOT, 'storage', 'entitlements.json');

async function migrateListings() {
  try {
    const raw = await fs.readFile(LISTINGS_FILE, 'utf-8');
    const items = JSON.parse(raw);
    await writeApps(items);
    console.log(`migrated ${items.length} listings`);
  } catch {
    console.log('no listings to migrate');
  }
}

async function migrateAppKv() {
  try {
    const files = await fs.readdir(KV_APPS_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const appId = path.basename(f, '.json');
      const data = JSON.parse(await fs.readFile(path.join(KV_APPS_DIR, f), 'utf-8'));
      await writeAppKv(appId, data);
    }
    console.log('migrated app kv');
  } catch {
    console.log('no app kv to migrate');
  }
}

async function migrateLikes() {
  try {
    const files = await fs.readdir(LIKES_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = path.basename(f, '.json');
      const arr = JSON.parse(await fs.readFile(path.join(LIKES_DIR, f), 'utf-8')) as string[];
      for (const uid of arr) {
        await setAppLike(id, uid, true);
      }
    }
    console.log('migrated likes');
  } catch {
    console.log('no likes to migrate');
  }
}

async function migrateEntitlements() {
  try {
    const raw = await fs.readFile(ENTITLEMENTS_FILE, 'utf-8');
    const items = JSON.parse(raw);
    await writeEntitlements(items);
    console.log(`migrated ${items.length} entitlements`);
  } catch {
    console.log('no entitlements to migrate');
  }
}

async function seedOglasiCollection() {
  try {
    await writeOglasi([]);
    console.log('seeded oglasi collection');
  } catch {
    console.log('failed to seed oglasi collection');
  }
}

async function seedBase() {
  const existingApps = await readApps();
  const existingCreators = await readCreators();
  if (existingApps.length > 0 || existingCreators.length > 0) {
    return;
  }
  const creators = [
    { id: 'demo', handle: 'demo', bio: 'Demo creator', plan: 'free' },
  ];
  const apps = [
    {
      id: 'demo-app',
      title: 'Demo App',
      description: 'Sample application',
      visibility: 'public',
      accessMode: 'public',
      playUrl: '/play/demo-app/',
      createdAt: Date.now(),
      author: { uid: 'demo', name: 'Demo Creator' },
      likesCount: 0,
      playsCount: 0,
      state: 'active',
    },
  ];
  await writeCreators(creators as any);
  await writeApps(apps as any);
  console.log('seeded creators and apps');
}

await migrateListings();
await migrateAppKv();
await migrateLikes();
await migrateEntitlements();
await seedOglasiCollection();
await seedBase();

console.log('migration complete');

import 'dotenv/config';
