import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyPluginAsync } from 'fastify';

const plugin: FastifyPluginAsync = fp(async (app) => {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Thesara Rooms API',
        description: 'Rooms V1 synchronization service.',
        version: '1.0.0',
      },
      tags: [{ name: 'rooms', description: 'Room sync endpoints' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
});

export default plugin;
