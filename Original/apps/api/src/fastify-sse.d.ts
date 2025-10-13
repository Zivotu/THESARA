import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyReply {
    sse(req: FastifyRequest): { send: (data: string) => void };
  }
}

export {};
