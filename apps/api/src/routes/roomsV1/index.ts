import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { RoomsService, HttpError } from '../../modules/roomsV1/service.js';
import {
  createRoomBodySchema,
  joinRoomBodySchema,
  addItemBodySchema,
  updateItemBodySchema,
  finalizeBodySchema,
  rotatePinBodySchema,
  roomCodeSchema,
  RoomStateDto,
  MemberDto,
} from '../../modules/roomsV1/schema.js';
import type { RoomSessionToken } from '../../plugins/jwt.js';
import { getConfig } from '../../config.js';
import type { Role } from '@prisma/client';

const service = new RoomsService();
const baseConfig = getConfig();
const { ROOMS_V1: roomsConfig } = baseConfig;
const PUBLISH_ROOMS_AUTOBRIDGE = !!(baseConfig as any).PUBLISH_ROOMS_AUTOBRIDGE;
const THESARA_ROOMS_KEYS = (baseConfig as any).THESARA_ROOMS_KEYS;

function parseIfMatch(request: any): number | undefined {
  const raw = request.headers?.['if-match'];
  if (!raw) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const numeric = Number(String(value).replace(/(^W\/)?\"?([0-9]+)\"?$/, '$2'));
  if (!Number.isInteger(numeric)) {
    throw new HttpError(400, 'invalid_if_match', 'If-Match header must be an integer version.');
  }
  return numeric;
}

function parseIdempotencyKey(request: any): string | undefined {
  const raw = request.headers?.['x-idempotency-key'] ?? request.headers?.['idempotency-key'];
  if (!raw) return undefined;
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key) return undefined;
  if (String(key).length > 120) {
    throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency key too long (max 120 chars).');
  }
  return String(key);
}

function sessionToActor(session: RoomSessionToken): MemberDto {
  const safeName = session.name && session.name.trim().length > 0 ? session.name : 'anon';
  return {
    id: session.memberId,
    name: safeName,
    role: session.role as Role,
    joinedAt: new Date().toISOString(),
  };
}

function formatRoomResponse(room: RoomStateDto) {
  return {
    room: room.room,
    members: room.members,
    items: room.items,
    history: room.history,
  };
}

const routes: FastifyPluginAsync = async (app) => {
  const prefix = '/rooms/v1';

  app.post(
    prefix,
    {
      schema: {
        tags: ['rooms'],
        body: {
          type: 'object',
          required: ['roomCode', 'pin'],
          properties: {
            roomCode: { type: 'string', pattern: '^[a-z0-9-]{1,64}$' },
            pin: { type: 'string', pattern: '^\\d{4,8}$' },
            name: { type: 'string' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              room: {
                type: 'object',
                required: ['id', 'roomCode', 'version', 'tokenVersion', 'updatedAt'],
                properties: {
                  id: { type: 'string' },
                  roomCode: { type: 'string' },
                  version: { type: 'integer' },
                  tokenVersion: { type: 'integer' },
                  updatedAt: { type: 'string', format: 'date-time' },
                },
              },
              member: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  role: { type: 'string' },
                  joinedAt: { type: 'string', format: 'date-time' },
                },
              },
              token: { type: 'string' },
            },
          },
        },
      },
      config: {
        rateLimit: { max: roomsConfig.rateLimitMax },
      },
    },
    async (request, reply) => {
      try {
        const parsed = createRoomBodySchema.parse(request.body);
        const result = await service.createRoom(parsed);
        const token = app.signRoomToken(result.token);
        reply.code(201);
        return reply.send({
          room: result.room,
          member: result.member,
          token,
        });
      } catch (err) {
        if (err instanceof HttpError) {
          return reply.code(err.statusCode).send({
            code: err.code,
            message: err.message,
            details: err.details,
          });
        }
        throw err;
      }
    },
  );

  const bridgeLoadSchema = z.object({
    appId: z.string().trim().min(1).max(120),
    key: z.string().trim().min(1).max(180),
  });
  const bridgeSaveSchema = bridgeLoadSchema.extend({
    payload: z
      .union([z.string(), z.null()])
      .optional()
      .refine(
        (val) => (typeof val === 'string' ? val.length <= 200_000 : true),
        'payload too large (200k max)',
      ),
  });

  app.post(`${prefix}/bridge/load`, async (request, reply) => {
    if (!PUBLISH_ROOMS_AUTOBRIDGE) {
      return reply.code(404).send({ code: 'bridge_disabled', message: 'Rooms auto-bridge disabled' });
    }
    const uid = request.authUser?.uid;
    if (!uid) {
      return reply.code(401).send({ code: 'unauthorized', message: 'Authentication required' });
    }
    try {
      const body = bridgeLoadSchema.parse(request.body);
      if (
        Array.isArray(THESARA_ROOMS_KEYS) &&
        THESARA_ROOMS_KEYS.length &&
        !THESARA_ROOMS_KEYS.includes(body.key)
      ) {
        return reply.code(403).send({ code: 'bridge_key_not_allowed', message: 'Storage key not allowed' });
      }
      const payload = await service.loadBridgeState(body.appId, uid, body.key);
      return reply.send({ payload });
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.code(err.statusCode).send({ code: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.post(`${prefix}/bridge/save`, async (request, reply) => {
    if (!PUBLISH_ROOMS_AUTOBRIDGE) {
      return reply.code(404).send({ code: 'bridge_disabled', message: 'Rooms auto-bridge disabled' });
    }
    const uid = request.authUser?.uid;
    if (!uid) {
      return reply.code(401).send({ code: 'unauthorized', message: 'Authentication required' });
    }
    try {
      const body = bridgeSaveSchema.parse(request.body);
      if (
        Array.isArray(THESARA_ROOMS_KEYS) &&
        THESARA_ROOMS_KEYS.length &&
        !THESARA_ROOMS_KEYS.includes(body.key)
      ) {
        return reply.code(403).send({ code: 'bridge_key_not_allowed', message: 'Storage key not allowed' });
      }
      await service.saveBridgeState(body.appId, uid, body.key, body.payload ?? null);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.code(err.statusCode).send({ code: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.post(
    `${prefix}/:roomCode/join`,
    {
      schema: {
        tags: ['rooms'],
        params: {
          type: 'object',
          required: ['roomCode'],
          properties: {
            roomCode: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          required: ['pin'],
          properties: {
            pin: { type: 'string', pattern: '^\\d{4,8}$' },
            name: { type: 'string' },
          },
        },
      },
      config: { rateLimit: { max: roomsConfig.rateLimitMax } },
    },
    async (request, reply) => {
      try {
        const roomCode = roomCodeSchema.parse((request.params as any).roomCode);
        const body = joinRoomBodySchema.parse(request.body);
        const result = await service.joinRoom(body, roomCode);
        const token = app.signRoomToken(result.token);
        return reply.send({
          room: result.room,
          member: result.member,
          token,
        });
      } catch (err) {
        if (err instanceof HttpError) {
          return reply.code(err.statusCode).send({
            code: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    },
  );

  app.get(
    `${prefix}/:roomCode`,
    {
      schema: {
        tags: ['rooms'],
        params: {
          type: 'object',
          required: ['roomCode'],
          properties: { roomCode: { type: 'string' } },
        },
        querystring: {
          type: 'object',
          properties: {
            since: { type: 'integer' },
            sinceVersion: { type: 'integer' },
          },
        },
      },
      config: { rateLimit: { max: roomsConfig.rateLimitMax * 2 } },
      preHandler: app.authenticateRoom,
    },
    async (request, reply) => {
      try {
        const roomCode = roomCodeSchema.parse((request.params as any).roomCode);
        const query = z
          .object({
            since: z.coerce.number().optional(),
            sinceVersion: z.coerce.number().int().optional(),
          })
          .parse(request.query);
        const state = await service.getRoomState(roomCode, query);
        return reply.send(formatRoomResponse(state));
      } catch (err) {
        if (err instanceof HttpError) {
          return reply.code(err.statusCode).send({
            code: err.code,
            message: err.message,
            details: err.details,
          });
        }
        throw err;
      }
    },
  );

  app.post(
    `${prefix}/:roomCode/items`,
    {
      schema: { tags: ['rooms'] },
      config: { rateLimit: { max: roomsConfig.rateLimitMax } },
      preHandler: app.authenticateRoom,
    },
    async (request, reply) => {
      try {
        const roomCode = roomCodeSchema.parse((request.params as any).roomCode);
        const body = addItemBodySchema.parse(request.body);
        const session = request.roomSession!;
        const actor = sessionToActor(session);
        const expectedVersion = parseIfMatch(request);
        const idempotencyKey = parseIdempotencyKey(request);
        const result = await service.addItem(roomCode, body, {
          expectedVersion,
          idempotencyKey,
          actor,
        });
        reply.code(201);
        return reply.send(result);
      } catch (err) {
        if (err instanceof HttpError) {
          return reply.code(err.statusCode).send({
            code: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    },
  );

  app.patch(
    `${prefix}/:roomCode/items/:itemId`,
    {
      schema: { tags: ['rooms'] },
      config: { rateLimit: { max: roomsConfig.rateLimitMax } },
      preHandler: app.authenticateRoom,
    },
    async (request, reply) => {
      try {
        const roomCode = roomCodeSchema.parse((request.params as any).roomCode);
        const itemId = z.string().min(1).parse((request.params as any).itemId);
        const body = updateItemBodySchema.parse(request.body);
        const expectedVersion = parseIfMatch(request);
        const result = await service.updateItem(roomCode, itemId, body, {
          expectedVersion,
        });
        return reply.send(result);
      } catch (err) {
        if (err instanceof HttpError) {
          return reply.code(err.statusCode).send({
            code: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    },
  );

  app.delete(
    `${prefix}/:roomCode/items/:itemId`,
    {
      schema: { tags: ['rooms'] },
      config: { rateLimit: { max: roomsConfig.rateLimitMax } },
      preHandler: app.authenticateRoom,
    },
    async (request, reply) => {
      try {
        const roomCode = roomCodeSchema.parse((request.params as any).roomCode);
        const itemId = z.string().min(1).parse((request.params as any).itemId);
        const expectedVersion = parseIfMatch(request);
        const result = await service.deleteItem(roomCode, itemId, {
          expectedVersion,
        });
        return reply.send(result);
      } catch (err) {
        if (err instanceof HttpError) {
          return reply.code(err.statusCode).send({
            code: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    },
  );

  app.post(
    `${prefix}/:roomCode/finalize`,
    {
      schema: { tags: ['rooms'] },
      config: { rateLimit: { max: roomsConfig.rateLimitMax } },
      preHandler: app.authenticateRoom,
    },
    async (request, reply) => {
      try {
        const roomCode = roomCodeSchema.parse((request.params as any).roomCode);
        const body = finalizeBodySchema.parse(request.body ?? {});
        const session = request.roomSession!;
        const expectedVersion = parseIfMatch(request);
        const idempotencyKey = parseIdempotencyKey(request);
        const result = await service.finalizePurchase(roomCode, body, {
          expectedVersion,
          idempotencyKey,
          actor: sessionToActor(session),
        });
        return reply.send(result);
      } catch (err) {
        if (err instanceof HttpError) {
          return reply.code(err.statusCode).send({
            code: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    },
  );

  app.post(
    `${prefix}/:roomCode/rotate-pin`,
    {
      schema: { tags: ['rooms'] },
      config: { rateLimit: { max: roomsConfig.rateLimitMax } },
      preHandler: app.authenticateRoom,
    },
    async (request, reply) => {
      try {
        const roomCode = roomCodeSchema.parse((request.params as any).roomCode);
        const body = rotatePinBodySchema.parse(request.body);
        const session = request.roomSession!;
        const expectedVersion = parseIfMatch(request);
        const result = await service.rotatePin(
          roomCode,
          body,
          sessionToActor(session),
          { expectedVersion },
        );
        return reply.send(result);
      } catch (err) {
        if (err instanceof HttpError) {
          return reply.code(err.statusCode).send({
            code: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    },
  );
};

export default routes;
