import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { performance } from 'node:perf_hooks';
import {
  Registry,
  collectDefaultMetrics,
  Histogram,
  Counter,
} from 'prom-client';

declare module 'fastify' {
  interface FastifyInstance {
    metricsRegistry: Registry;
    metrics: {
      httpRequestDuration: Histogram<'method' | 'route' | 'status'>;
      httpRequestsTotal: Counter<'method' | 'route' | 'status'>;
    };
  }
}

const plugin: FastifyPluginAsync = fp(async (app) => {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total count of HTTP requests',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  });

  app.decorate('metricsRegistry', registry);
  app.decorate('metrics', { httpRequestDuration, httpRequestsTotal });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url || request.url || 'unknown';
    const method = request.method.toUpperCase();
    const status = reply.statusCode.toString();
    const started = (request as any)._startAt as number | undefined;
    const durationSeconds =
      started !== undefined ? (performance.now() - started) / 1000 : 0;
    httpRequestDuration
      .labels({ method, route, status })
      .observe(durationSeconds);
    httpRequestsTotal.labels({ method, route, status }).inc();
  });

  app.addHook('onRequest', async (request) => {
    (request as any)._startAt = performance.now();
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return reply.send(await registry.metrics());
  });
});

export default plugin;
