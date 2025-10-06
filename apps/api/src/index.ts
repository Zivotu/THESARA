import 'dotenv/config';
import fastify, {
  type FastifyRequest,
  type FastifyReply,
  type FastifyInstance,
} from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import csrf from '@fastify/csrf-protection';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import rawBody from 'fastify-raw-body';
import fs from 'node:fs';
import path from 'node:path';
import { BUNDLE_ROOT, PREVIEW_ROOT } from './paths.js';
import './shims/registerSwcHelpers.js';
import { getConfig, ALLOWED_ORIGINS } from './config.js';

import { validateEnv } from './env.js';
import auth from './middleware/auth.js';

import authDebug from './routes/authDebug.js';
import billingRoutes from './routes/billing.js';
import createxProxy from './routes/createxProxy.js';
import recenzijeRoutes from './routes/recenzije.js';
import roomsRoutes from './routes/rooms.js';
import shims from './routes/shims.js';
import oglasiRoutes from './routes/oglasi.js';
import { uploadRoutes } from './routes/upload.js';
import buildRoutes from './routes/build.js';
import avatarRoutes from './routes/avatar.js';
import publishRoutes from './routes/publish.js';
import reviewRoutes from './routes/review.js';
import listingsRoutes from './routes/listings.js';
import accessRoutes from './routes/access.js';
import meRoutes from './routes/me.js';
import configRoutes from './routes/config.js';
import publicRoutes from './routes/public.js';
import creatorsRoutes from './routes/creators.js';
import trialRoutes from './routes/trial.js';
import ownerRoutes from './routes/owner.js';
import versionRoutes from './routes/version.js';
import entitlementsRoutes from './routes/entitlements.js';
import { startCreatexBuildWorker } from './workers/createxBuildWorker.js';
import { ensureDbInitialized } from './db.js';

export let app: FastifyInstance;

export async function createServer() {
  validateEnv();
  const config = getConfig();
  await ensureDbInitialized();

  app = fastify({ logger: true });
  app.log.info(
    { PORT: config.PORT, NODE_ENV: process.env.NODE_ENV, BUNDLE_ROOT, PREVIEW_ROOT },
    'env'
  );

  const isProd = process.env.NODE_ENV === 'production';
  const allowedFromEnv = (process.env.ALLOWED_ORIGINS || "")
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const prodDefaultOrigins = ['https://thesara.space'];
  const devFallbackOrigins = ALLOWED_ORIGINS;
  const resolvedAllowedOrigins =
    allowedFromEnv.length ? allowedFromEnv : (isProd ? prodDefaultOrigins : devFallbackOrigins);

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, resolvedAllowedOrigins.includes(origin));
    },
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(helmet, { contentSecurityPolicy: false, frameguard: false });

  // allowlist for production + local dev
  const ALLOWED_ORIGINS_CORS = new Set([
    'https://thesara.space',
    'http://localhost:3000',
  ]);

  app.addHook('onSend', (req, reply, payload, done) => {
    const url = req.url || req.raw?.url || '';

    // Static / embeddable responses we expose to the web app
    if (url.startsWith('/assets') || url.startsWith('/builds') || url.startsWith('/avatar')) {
      // CORP must be cross-origin so browsers can display images from api.* on thesara.*
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');

      // CORS: reflect an allowed Origin, so dev & prod both work
      const origin = req.headers.origin as string | undefined;
      if (origin && ALLOWED_ORIGINS_CORS.has(origin)) {
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Vary', 'Origin');
        reply.header('Access-Control-Allow-Credentials', 'true');
      }
    }
    done();
  });

  await app.register(cookie);
  // CSRF protection blocks cross-origin JSON POSTs unless clients send tokens.
  // Our API uses Authorization headers (not cookie sessions), which is CSRF-safe.
  // Keep it opt-in via CSRF_ENABLED to avoid breaking publish and other POSTs.
  if (process.env.CSRF_ENABLED === 'true') {
    await app.register(csrf);
  }
  await app.register(multipart);
  await app.register(rawBody, { field: 'rawBody', global: false, encoding: 'utf8' });

  // Static assets from the project public directory
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'public'),
    prefix: '/',
    decorateReply: false,
  });

  app.get('/', async (_req, reply) => {
    return reply.type('text/html').send('OK');
  });
  app.get('/healthz', async () => ({ ok: true }));
  // Build artifacts
  const setStaticHeaders = (res: any, pathName?: string) => {
    const cfg = getConfig();
    const frameAncestors = ["'self'"];
    try {
      const webBase = getConfig().WEB_BASE;
      if (webBase) {
        const origin = new URL(webBase).origin;
        if (origin && !frameAncestors.includes(origin)) frameAncestors.push(origin);
      }
    } catch {}
    if (process.env.NODE_ENV !== 'production') {
      frameAncestors.push('http://localhost:3000', 'http://127.0.0.1:3000');
    }

    // Try to extract buildId from the served file path
    let buildId: string | undefined;
    try {
      const p = String(pathName || '');
      const m = /[\\\/]builds[\\\/]([^\\\/]+)[\\\/]/.exec(p);
      buildId = m?.[1];
    } catch {}

    // Defaults
    const cdn = (cfg.CDN_BASE || 'https://esm.sh').replace(/\/+$/, '');
    const cdnOrigin = new URL(cdn).origin;
    let networkPolicy: 'NO_NET' | 'MEDIA_ONLY' | 'OPEN_NET' = 'NO_NET';
    let networkDomains: string[] = [];
    try {
      if (buildId) {
        // Read build record for policy
        try {
          const recPath = path.join(BUNDLE_ROOT, 'builds', buildId, 'build.json');
          const raw = fs.readFileSync(recPath, 'utf8');
          const rec = JSON.parse(raw);
          if (rec?.networkPolicy) networkPolicy = rec.networkPolicy;
        } catch {}
        // Read manifest for domains
        try {
          const manPath = path.join(BUNDLE_ROOT, 'builds', buildId, 'build', 'manifest_v1.json');
          const mraw = fs.readFileSync(manPath, 'utf8');
          const man = JSON.parse(mraw);
          if (Array.isArray(man?.networkDomains)) networkDomains = man.networkDomains;
        } catch {}
      }
    } catch {}

    // CSP pieces
    const scriptSrc = [
      "'self'",
      cfg.EXTERNAL_HTTP_ESM ? cdnOrigin : undefined,
      'https://js.stripe.com',
      'https://m.stripe.network',
    ]
      .filter(Boolean)
      .join(' ');
    const styleSrc = "'self'";
    const imgSrc =
      networkPolicy === 'MEDIA_ONLY' || networkPolicy === 'OPEN_NET'
        ? "* data: blob:"
        : "'self' data: blob:";
    const mediaSrc =
      networkPolicy === 'MEDIA_ONLY' || networkPolicy === 'OPEN_NET'
        ? "* blob:"
        : "'self' blob:";
    const frameSrc = "'self' https://js.stripe.com https://m.stripe.network";
    const connectParts: string[] = [
      "'self'",
      'https://js.stripe.com',
      'https://m.stripe.network',
    ];
    if (networkPolicy === 'OPEN_NET') {
      // Allow only declared domains; if empty, fall back to https: (conservative)
      if (networkDomains.length > 0) {
        for (const d of networkDomains) {
          try {
            const origin = new URL(d.startsWith('http') ? d : `https://${d}`).origin;
            connectParts.push(origin);
          } catch {}
        }
      } else {
        connectParts.push('https:');
      }
    }
    const connectSrc = connectParts.join(' ');
    const baseUri = "'none'";
    const objectSrc = "'none'";

    const csp = [
      `default-src 'self'`,
      `script-src ${scriptSrc}`,
      `style-src ${styleSrc}`,
      `img-src ${imgSrc}`,
      `media-src ${mediaSrc}`,
      `connect-src ${connectSrc}`,
      `frame-src ${frameSrc}`,
      `base-uri ${baseUri}`,
      `object-src ${objectSrc}`,
      `frame-ancestors ${frameAncestors.join(' ')}`,
    ].join('; ');

    // Read opt-in permission policy if present
    let policy = { camera: false, microphone: false, geolocation: false, clipboardRead: false, clipboardWrite: false } as any;
    try {
      if (buildId) {
        const polPath = path.join(BUNDLE_ROOT, 'builds', buildId, 'policy.json');
        const raw = fs.readFileSync(polPath, 'utf8');
        policy = { ...policy, ...JSON.parse(raw) };
      }
    } catch {}

    const pp = [
      `camera=(${policy.camera ? 'self' : ''})`,
      `microphone=(${policy.microphone ? 'self' : ''})`,
      `geolocation=(${policy.geolocation ? 'self' : ''})`,
      `clipboard-read=(${policy.clipboardRead ? 'self' : ''})`,
      `clipboard-write=(${policy.clipboardWrite ? 'self' : ''})`,
      `fullscreen=(self)`,
    ].join(', ');

    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Permissions-Policy', pp);
    res.setHeader('Referrer-Policy', 'no-referrer');

    const origin = res.req?.headers?.origin as string | undefined;
    if (origin && resolvedAllowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (resolvedAllowedOrigins.length > 0) {
      res.setHeader('Access-Control-Allow-Origin', resolvedAllowedOrigins[0]);
    }
    res.setHeader('Vary', 'Origin');
  };
  const setPreviewHeaders = (res: any) => {
    const fa = ["'self'"];
    try {
      const webBase = getConfig().WEB_BASE;
      if (webBase) {
        const origin = new URL(webBase).origin;
        if (origin && !fa.includes(origin)) fa.push(origin);
      }
    } catch {}
    if (process.env.NODE_ENV !== 'production') {
      fa.push('http://localhost:3000', 'http://127.0.0.1:3000');
    }
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; frame-ancestors ${fa.join(' ')}`,
    );
  };

  app.get('/builds/:id/preview.png', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = (req.params as any)?.id as string;

    // Basic traversal protection
    if (!id || id.includes('..') || id.includes('/')) {
      return reply.code(400).send({ error: 'Invalid build ID' });
    }

    // Long-lived caching for both PNG and SVG
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');

    // --- 1. Try to serve the actual PNG ---
    const storageRoot = config.BUNDLE_STORAGE_PATH;
    if (storageRoot) {
      const previewPath = path.join(storageRoot, 'builds', id, 'preview.png');
      try {
        const data = await fs.promises.readFile(previewPath);
        reply.type('image/png');
        return reply.send(data);
      } catch (e: any) {
        if (e.code !== 'ENOENT') {
          req.log.warn({ err: e, id, path: previewPath }, 'preview-png-read-error');
        }
        // If not found (ENOENT) or any other error, fall through to placeholder.
      }
    } else {
      req.log.warn('BUNDLE_STORAGE_PATH is not set, serving placeholder');
    }

    // --- 2. Fallback to placeholder SVG ---
    try {
      const isProd = process.env.NODE_ENV === 'production';
      const candidates = [
        // Production absolute path, as per documentation
        isProd ? '/home/conexa/api.thesara.space/public/preview-placeholder.svg' : null,
        // Relative to build output (__dirname)
        path.join(__dirname, '..', 'public', 'preview-placeholder.svg'),
        // Relative to CWD (less reliable, but good for local dev)
        path.join(process.cwd(), 'public', 'preview-placeholder.svg'),
      ].filter(Boolean) as string[];

      for (const p of candidates) {
        try {
          const data = await fs.promises.readFile(p);
          reply.type('image/svg+xml');
          return reply.send(data);
        } catch {
          // Try next candidate
        }
      }

      // --- 3. Last resort: inline minimal SVG ---
      req.log.warn('No placeholder SVG file found, serving inline SVG.');
      reply.type('image/svg+xml');
      const inlineSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="144"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#6b7280">No preview</text></svg>`;
      return reply.send(inlineSvg);
    } catch (err: any) {
      req.log.error({ err, id }, 'preview-handler-failed');
      // This catch block should ideally not be hit with the new logic, but it's good for safety.
      // Send a generic error instead of the inline SVG to make it clear something is wrong.
      return reply.code(500).send({ error: 'Failed to serve preview or placeholder' });
    }
  });

  await app.register(fastifyStatic, {
    root: path.join(config.BUNDLE_STORAGE_PATH, 'builds'),
    prefix: '/builds/',
    decorateReply: false,
    redirect: true,
    index: ['index.html'],
    setHeaders: setStaticHeaders,
  });

  // Preview build artifacts
  const allowPreview =
    process.env.NODE_ENV !== 'production' || process.env.ALLOW_REVIEW_PREVIEW === 'true';

  app.get('/_debug/preview-root', async (req: FastifyRequest) => {
    const id = (req.query as any)?.id as string | undefined;
    const sample = id ? path.join(PREVIEW_ROOT, id, 'index.html') : PREVIEW_ROOT;
    const exists = fs.existsSync(sample);
    return { PREVIEW_ROOT, sample, exists, NODE_ENV: process.env.NODE_ENV };
  });

  // Authentication middleware
  await app.register(auth);

  app.get('/_debug/whoami', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.authUser?.uid) {
      return { uid: req.authUser.uid, role: req.authUser.role, claims: req.authUser.claims };
    }
    return reply.code(401).send({ error: 'unauthenticated' });
  });

  // Routes
  await app.register(authDebug);
  await app.register(billingRoutes);
  await app.register(createxProxy);
  await app.register(recenzijeRoutes);
  await app.register(roomsRoutes);
  await app.register(shims);
  await app.register(uploadRoutes);
  await app.register(publishRoutes);
  await app.register(listingsRoutes);
  await app.register(accessRoutes);
  await app.register(versionRoutes);
  await app.register(oglasiRoutes);
  await app.register(buildRoutes);
  await app.register(avatarRoutes);
  await app.register(reviewRoutes);
  await app.register(entitlementsRoutes);
  await app.register(meRoutes);
  await app.register(configRoutes);
  await app.register(publicRoutes);
  await app.register(creatorsRoutes);
  await app.register(trialRoutes);
  await app.register(ownerRoutes);

  if (allowPreview) {
    await app.register(fastifyStatic, {
      root: PREVIEW_ROOT,
      prefix: '/review/builds/',
      decorateReply: false,
      redirect: true,
      index: ['index.html'],
      setHeaders: setPreviewHeaders,
      allowedPath: (pathname) => !/\/llm(?:\/|$)/.test(pathname),
    });
  }

  // Health endpoint
  app.route({
    method: ['GET', 'HEAD'],
    url: '/health',
    handler: (_req: FastifyRequest, reply: FastifyReply) =>
      reply.send({ ok: true, ts: Date.now() }),
  });

  app.all('/api/*', (_req: FastifyRequest, reply: FastifyReply) => {
    reply.code(404).send({ error: 'Use frontend proxy /api/*, not API host with /api prefix' });
  });

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    const diagDir = path.join(process.cwd(), '.diag');
    fs.mkdirSync(diagDir, { recursive: true });
    fs.appendFileSync(
      path.join(diagDir, 'notfound.log'),
      `${new Date().toISOString()} ${req.method} ${req.url}\n`
    );
    reply.code(404).send({ error: 'Not found' });
  });

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, 'request_failed');
    const isProd = process.env.NODE_ENV === 'production';
    if (reply.sent) return; // safety
    return reply.code(500).send(
      isProd ? { error: 'Internal Server Error' } : { error: err.message, stack: err.stack }
    );
  });

  void app.ready().then(() => {
    const routes = app.printRoutes();
    app.log.info(routes);
    const diagDir = path.join(process.cwd(), '.diag');
    fs.mkdirSync(diagDir, { recursive: true });
    fs.writeFileSync(path.join(diagDir, 'fastify-routes.txt'), routes);
  });

  return { app, config };
}

export async function start(): Promise<void> {
  const { app } = await createServer();
  const enableWorker = process.env.CREATEX_WORKER_ENABLED === 'true';
  const buildWorker = enableWorker ? startCreatexBuildWorker() : { close: async () => {} };

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await buildWorker.close();
    await app.close();
    process.exit(0);
  };

  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.once(signal, () => {
      void shutdown(signal);
    });
  });

  const basePort = Number(process.env.PORT) || 8788;
  const maxAttempts = Number(process.env.PORT_FALLBACK_ATTEMPTS || '10');
  let listened = false;
  let lastError: any;

  for (let i = 0; i < maxAttempts; i++) {
    const port = basePort + i;
    try {
      await app.listen({ port, host: '0.0.0.0' });
      app.log.info(`listening on ${port}`);
      try {
        const diagDir = path.join(process.cwd(), '.diag');
        fs.mkdirSync(diagDir, { recursive: true });
        fs.writeFileSync(path.join(diagDir, 'api-port.txt'), String(port));
      } catch {}
      listened = true;
      break;
    } catch (err: any) {
      lastError = err;
      if (err && err.code === 'EADDRINUSE') {
        app.log.warn({ port }, 'port in use, trying next');
        continue;
      }
      app.log.error(err);
      await buildWorker.close();
      try {
        await app.close();
      } catch {}
      throw err;
    }
  }

  if (!listened) {
    const error = lastError ?? new Error('failed to bind any port');
    app.log.error({ basePort, attempts: maxAttempts, error });
    await buildWorker.close();
    try {
      await app.close();
    } catch {}
    throw error;
  }
}

export { start as bootstrap };

void (async () => {
  if (process.env.NODE_ENV !== 'test') {
    try {
      await start();
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  }
})();
