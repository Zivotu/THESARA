import fastify, { type FastifyRequest, type FastifyReply } from 'fastify';

export function checkTypes(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  // Ensure commonly used raw properties compile
  req.headers;
  req.raw;
  reply.raw;
  reply.hijack();
}
