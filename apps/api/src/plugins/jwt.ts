import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getConfig } from '../config.js';

export interface RoomSessionToken {
  roomId: string;
  memberId: string;
  role: 'OWNER' | 'MEMBER';
  name?: string;
  tokenVersion: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    signRoomToken(payload: RoomSessionToken, expiresIn?: string | number): string;
    authenticateRoom(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }

  interface FastifyRequest {
    roomSession?: RoomSessionToken;
  }
}

const plugin: FastifyPluginAsync = fp(async (app) => {
  const config = getConfig();
  const roomsConfig = config.ROOMS_V1;

  app.register(jwt, {
    secret: roomsConfig.jwtSecret,
    sign: {
      issuer: roomsConfig.jwtIssuer,
      audience: roomsConfig.jwtAudience,
    },
    verify: {
      issuer: roomsConfig.jwtIssuer,
      audience: roomsConfig.jwtAudience,
    },
  });

  app.decorate(
    'signRoomToken',
    (payload: RoomSessionToken, expiresIn?: string | number) => {
      const ttl = expiresIn ?? `${roomsConfig.tokenTtlSeconds}s`;
      return app.jwt.sign(payload, { expiresIn: ttl });
    },
  );

  app.decorate('authenticateRoom', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const decoded = await request.jwtVerify<RoomSessionToken>();
      request.roomSession = decoded;
    } catch (err) {
      reply.log.debug({ err }, 'rooms:jwt_invalid');
      const authError = new Error('Invalid or expired room session token.');
      (authError as any).statusCode = 401;
      (authError as any).code = 'unauthorized';
      throw authError;
    }
  });
});

export default plugin;
