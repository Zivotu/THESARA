import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../prisma/client.js';
import { getAppByIdOrSlug } from '../db.js';
import type { AppRecord } from '../types.js';

type AppStorageKey = {
  appId: string;
  roomId: string;
  key: string;
};

type AppStorageRecord = AppStorageKey & {
  id: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
};

type AppStorageWhereUnique = { app_storage_app_room_key: AppStorageKey };

type AppStorageDelegate = {
  upsert(args: {
    where: AppStorageWhereUnique;
    update: { value: string };
    create: AppStorageKey & { value: string };
  }): Promise<AppStorageRecord>;
  findUnique(args: { where: AppStorageWhereUnique }): Promise<AppStorageRecord | null>;
  deleteMany(args: { where: AppStorageKey }): Promise<{ count: number }>;
};

type PrismaClientWithAppStorage = PrismaClient & { appStorage: AppStorageDelegate };

function assertHasAppStorage(client: PrismaClient): asserts client is PrismaClientWithAppStorage {
  const delegate = (client as Partial<PrismaClientWithAppStorage>).appStorage;
  if (typeof delegate?.upsert !== 'function') {
    throw new Error(
      'Prisma client is missing the appStorage delegate. Did you run "pnpm --filter @loopyway/api prisma:generate"?',
    );
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    storageContext?: {
      appId: string;
      appRecord: AppRecord;
      userId: string;
    };
  }
}

const BODY_SCHEMA = z.object({
  roomId: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(256),
  value: z.string(),
});

const QUERY_SCHEMA = z.object({
  roomId: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(256),
});

function normalizeAppHeader(header: unknown): string | null {
  if (!header) return null;
  if (Array.isArray(header)) {
    const [first] = header;
    return typeof first === 'string' && first.trim().length ? first.trim() : null;
  }
  if (typeof header !== 'string') return null;
  const trimmed = header.trim();
  return trimmed.length ? trimmed : null;
}

async function resolveStorageContext(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ appId: string; record: AppRecord } | null> {
  const uid = req.authUser?.uid;
  if (!uid) {
    void reply.code(401).send({ error: 'unauthenticated' });
    return null;
  }
  const headerValue = normalizeAppHeader(req.headers['x-thesara-app-id']);
  if (!headerValue) {
    void reply.code(400).send({ error: 'missing_app_id' });
    return null;
  }
  const appRecord = await getAppByIdOrSlug(headerValue);
  if (!appRecord) {
    void reply.code(404).send({ error: 'app_not_found' });
    return null;
  }
  const storageEnabled =
    appRecord.capabilities?.storage?.enabled === true ||
    (Array.isArray(appRecord.capabilities?.features) &&
      appRecord.capabilities!.features!.includes('storage'));
  if (!storageEnabled) {
    void reply.code(403).send({ error: 'storage_not_enabled' });
    return null;
  }
  const appId = String(appRecord.id ?? headerValue);
  req.storageContext = { appId, appRecord, userId: uid };
  return { appId, record: appRecord };
}

export default async function storageRoutes(app: FastifyInstance) {
  assertHasAppStorage(prisma);
  const storageClient = prisma.appStorage;

  app.post('/storage/item', async (req, reply) => {
    const ctx = await resolveStorageContext(req, reply);
    if (!ctx) return;
    const parsed = BODY_SCHEMA.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }
    const { roomId, key, value } = parsed.data;

    await storageClient.upsert({
      where: { app_storage_app_room_key: { appId: ctx.appId, roomId, key } },
      update: { value },
      create: { appId: ctx.appId, roomId, key, value },
    });

    // Upsert does not tell us whether it inserted or updated, so 200 OK remains correct.
    return reply.code(200).send({ ok: true });
  });

  app.get('/storage/item', async (req, reply) => {
    const ctx = await resolveStorageContext(req, reply);
    if (!ctx) return;
    const parsed = QUERY_SCHEMA.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', details: parsed.error.flatten() });
    }
    const { roomId, key } = parsed.data;
    const where = { app_storage_app_room_key: { appId: ctx.appId, roomId, key } };
    const existing = await storageClient.findUnique({ where }).catch(() => null);
    if (!existing) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.code(200).send({ value: existing.value });
  });

  app.delete('/storage/item', async (req, reply) => {
    const ctx = await resolveStorageContext(req, reply);
    if (!ctx) return;
    const parsed = QUERY_SCHEMA.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', details: parsed.error.flatten() });
    }
    const { roomId, key } = parsed.data;
    await storageClient.deleteMany({
      where: { appId: ctx.appId, roomId, key },
    });
    return reply.code(204).send();
  });
}
