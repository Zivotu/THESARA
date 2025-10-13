import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import { getConfig } from '../config.js';

const plugin: FastifyPluginAsync = fp(async (app) => {
  const { ROOMS_V1 } = getConfig();
  await app.register(rateLimit, {
    global: false,
    max: ROOMS_V1.rateLimitMax,
    timeWindow: '1 minute',
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  });
});

export default plugin;
