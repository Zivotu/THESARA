import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { listEntitlements, listAppsByOwner, getAppByIdOrSlug } from '../db.js';
import { getUserStorageBytes } from '../lib/storageUsage.js';
import { getConfig } from '../config.js';

export default async function meRoutes(app: FastifyInstance) {
  app.get('/me/entitlements', async (req, reply) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }

    const items = (await listEntitlements(uid)).filter(
      (e) => e.active !== false,
    );

    const gold = items.some((e) => e.feature === 'isGold');
    const noAds = items.some((e) => e.feature === 'noAds');
    const purchases = items
      .filter((e) => e.feature !== 'isGold' && e.feature !== 'noAds')
      .map((e) => e.feature);

    return { gold, noAds, purchases };
  });

  // Return full entitlements for the current user (including data payloads)
  app.get('/me/entitlements-full', async (req, reply) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }

    const items = (await listEntitlements(uid)).filter((e: any) => e.active !== false);
    return { items };
  });

  app.get('/me/usage', async (req, reply) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }

    const [apps, ents] = await Promise.all([
      listAppsByOwner(uid),
      listEntitlements(uid),
    ]);

    const gold = ents.some((e) => e.feature === 'isGold' && e.active !== false);
    const {
      MAX_APPS_PER_USER,
      GOLD_MAX_APPS_PER_USER,
      MAX_STORAGE_MB_PER_USER,
      GOLD_MAX_STORAGE_MB_PER_USER,
    } = getConfig();
    const appLimit = gold ? GOLD_MAX_APPS_PER_USER : MAX_APPS_PER_USER;
    const appsUsed = apps.length;
    const appsRemaining = Math.max(0, appLimit - appsUsed);

    const buildIds = apps.map((a: any) => a.buildId || a.id);
    const bytesUsed = await getUserStorageBytes(buildIds);
    const storageUsed = Math.round(bytesUsed / (1024 * 1024));
    const storageLimit = gold
      ? GOLD_MAX_STORAGE_MB_PER_USER
      : MAX_STORAGE_MB_PER_USER; // MB
    const storageRemaining = Math.max(0, storageLimit - storageUsed);

    return {
      plan: gold ? 'gold' : 'free',
      apps: { used: appsUsed, limit: appLimit, remaining: appsRemaining },
      storage: { used: storageUsed, limit: storageLimit, remaining: storageRemaining },
    };
  });

  app.get('/me/subscribed-apps', async (req, reply) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }

    const ents = (await listEntitlements(uid)).filter((e: any) => e.active !== false);

    const appIds = new Set<string>();

    for (const ent of ents) {
      if (ent.feature === 'app-subscription') {
        const appId = ent.data?.appId;
        if (appId) appIds.add(appId);
      } else if (ent.feature === 'creator-all-access') {
        const creatorId = ent.data?.creatorId;
        if (creatorId) {
          const creatorApps = await listAppsByOwner(creatorId);
          for (const app of creatorApps) {
            appIds.add(app.id);
          }
        }
      }
    }

    const items = [];

    for (const appId of appIds) {
      const app = await getAppByIdOrSlug(appId);
      if (app) {
        const listing = {
          id: app.id,
          slug: (app as any).slug || app.id,
          title: (app as any).title || 'Untitled',
          description: (app as any).description || '',
          tags: (app as any).tags || [],
          previewUrl: (app as any).previewUrl || '',
          playsCount: (app as any).playsCount || 0,
          likesCount: (app as any).likesCount || 0,
          likedByMe: false,
          price: (app as any).price || 0,
        };
        items.push(listing);
      }
    }

    return { items };
  });
}
