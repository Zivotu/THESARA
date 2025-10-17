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
import fsSync from 'node:fs';
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
import storageRoutes from './routes/storage.js';
import { startCreatexBuildWorker } from './workers/createxBuildWorker.js';
import localDevRoutes from './localdev/routes.js';
import { startLocalDevWorker } from './localdev/worker.js';
import { ensureDbInitialized } from './db.js';
import jwtPlugin from './plugins/jwt.js';
import metricsPlugin from './plugins/metrics.js';
import swaggerPlugin from './plugins/swagger.js';
import rateLimitPlugin from './plugins/rateLimit.js';
import roomsSyncV1Routes from './routes/roomsV1/index.js';

export let app: FastifyInstance;

export async function createServer() {
  // Ensure UI stub exists for builder in both dev and dist deployments
  try {
    const runtimeDir = __dirname;
    const builderDir = path.join(runtimeDir, 'builder');
    const dest = path.join(builderDir, 'virtual-ui.tsx');
    if (!fsSync.existsSync(dest)) {
      fsSync.mkdirSync(builderDir, { recursive: true });
      const candidates = [
        path.join(runtimeDir, '..', 'src', 'builder', 'virtual-ui.tsx'),
        path.join(process.cwd(), 'apps', 'api', 'src', 'builder', 'virtual-ui.tsx'),
      ];
      let copied = false;
      for (const c of candidates) {
        try {
          if (fsSync.existsSync(c)) {
            fsSync.copyFileSync(c, dest);
            copied = true;
            break;
          }
        } catch {}
      }
      if (!copied) {
        const stub = `import * as React from 'react';\nexport function Card(p:any){return React.createElement('div',{...p, className: (p.className||'')})}\nexport function CardHeader(p:any){return React.createElement('div',{...p, className: 'p-4 ' + (p.className||'')})}\nexport function CardTitle(p:any){return React.createElement('h3',{...p, className: 'text-lg font-semibold ' + (p.className||'')})}\nexport function CardContent(p:any){return React.createElement('div',{...p, className: 'p-4 ' + (p.className||'')})}\nexport function Button(p:any){return React.createElement('button',{...p, className: (p.className||'')})}\nexport function Input(p:any){return React.createElement('input',{...p, className: (p.className||'')})}\nexport function Label(p:any){return React.createElement('label',{...p, className: (p.className||'')})}\nexport function Textarea(p:any){return React.createElement('textarea',{...p, className: (p.className||'')})}\nexport function Slider(p:any){return React.createElement('input',{type:'range',...p})}\n`;
        fsSync.writeFileSync(dest, stub, 'utf8');
      }
    }
  } catch {}
  validateEnv();
  const config = getConfig();
  await ensureDbInitialized();

  app = fastify({ logger: true });
  app.log.info(
    { PORT: config.PORT, NODE_ENV: process.env.NODE_ENV, BUNDLE_ROOT, PREVIEW_ROOT },
    'env'
  );

  await app.register(cors, {
    origin: [
      'https://thesara.space',
      'https://www.thesara.space',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await app.register(metricsPlugin);
  await app.register(jwtPlugin);
  await app.register(rateLimitPlugin);
  await app.register(swaggerPlugin);
  await app.register(helmet, { contentSecurityPolicy: false, frameguard: false });

  // Allow being mounted behind "/api" prefix (prod) by stripping it early
  app.addHook('onRequest', (req, _reply, done) => {
    try {
      const raw = (req.raw?.url || req.url || '') as string;
      // 1) Support API behind /api prefix
      if (raw === '/api' || raw === '/api/') {
        (req as any).url = '/';
        if (req.raw) (req.raw as any).url = '/';
      } else if (raw.startsWith('/api/')) {
        const stripped = raw.slice(4) || '/';
        (req as any).url = stripped;
        if (req.raw) (req.raw as any).url = stripped;
      }

      // 2) Best-effort: auto-create minimal manifest if missing to avoid 404 white screens
      //    Pattern: /builds/:id/build/manifest_v1.json
      const urlForCheck = ((req as any).url || raw) as string;
      const m = /^\/builds\/([^\/]+)\/build\/manifest_v1\.json(?:[?#].*)?$/.exec(urlForCheck);
      if (m && m[1]) {
        try {
          const buildId = decodeURIComponent(m[1]);
          const cfg = getConfig();
          const buildDir = path.join(cfg.BUNDLE_STORAGE_PATH, 'builds', buildId, 'build');
          const manPath = path.join(buildDir, 'manifest_v1.json');
          try {
            fs.accessSync(manPath);
          } catch {
            // Create minimal manifest if app.js exists
            try {
              const appJs = path.join(buildDir, 'app.js');
              fs.accessSync(appJs);
              fs.mkdirSync(buildDir, { recursive: true });
              const manifest = {
                id: buildId,
                entry: 'app.js',
                name: buildId,
                description: '',
                networkPolicy: 'NO_NET',
                networkDomains: [],
              };
              fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2), 'utf8');
            } catch {}
          }
        } catch {}
      }
    } catch {}
    done();
  });

  const staticAllowedOrigins = new Set([
    ...ALLOWED_ORIGINS,
    'https://thesara.space',
    'https://www.thesara.space',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);

  app.addHook('onSend', (req, reply, _payload, done) => {
    const url = req.url || req.raw?.url || '';

    if (
      url.startsWith('/assets') ||
      url.startsWith('/builds') ||
      url.startsWith('/avatar') ||
      url.startsWith('/uploads')
    ) {
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');

      const origin = req.headers.origin as string | undefined;
      if (origin && staticAllowedOrigins.has(origin)) {
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

  // Local-dev CI/CD (zip -> queue -> build -> preview)
  await app.register(localDevRoutes);

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
    const scriptDomains: string[] = [
      "'self'",
      cfg.EXTERNAL_HTTP_ESM ? cdnOrigin : undefined,
      'https://js.stripe.com',
      'https://m.stripe.network',
    ].filter(Boolean) as string[];
    if (networkPolicy === 'OPEN_NET') {
      if (networkDomains.length > 0) {
        for (const d of networkDomains) {
          try {
            const origin = new URL(d.startsWith('http') ? d : `https://${d}`).origin;
            if (!scriptDomains.includes(origin)) scriptDomains.push(origin);
          } catch {}
        }
      } else {
        scriptDomains.push('https:');
      }
    }
    const scriptSrc = scriptDomains.join(' ');

    const styleParts: string[] = ["'self'"];
    if (!styleParts.includes("'unsafe-inline'")) {
      styleParts.push("'unsafe-inline'");
    }
    if (networkPolicy === 'OPEN_NET') {
      if (networkDomains.length > 0) {
        for (const d of networkDomains) {
          try {
            const origin = new URL(d.startsWith('http') ? d : `https://${d}`).origin;
            if (!styleParts.includes(origin)) styleParts.push(origin);
          } catch {}
        }
      } else {
        styleParts.push('https:');
      }
    }
    const styleSrc = styleParts.join(' ');

    const imgSrc =
      networkPolicy === 'MEDIA_ONLY' || networkPolicy === 'OPEN_NET'
        ? "* data: blob:"
        : "'self' data: blob:";
    const mediaSrc =
      networkPolicy === 'MEDIA_ONLY' || networkPolicy === 'OPEN_NET'
        ? '* blob:'
        : "'self' blob:";
    const frameSrc = "'self' https://js.stripe.com https://m.stripe.network";
    const connectParts: string[] = [
      "'self'",
      'https://js.stripe.com',
      'https://m.stripe.network',
    ];
    if (cfg.EXTERNAL_HTTP_ESM) {
      connectParts.push(cdnOrigin);
    }
    if (networkPolicy === 'OPEN_NET') {
      if (networkDomains.length > 0) {
        for (const d of networkDomains) {
          try {
            const origin = new URL(d.startsWith('http') ? d : `https://${d}`).origin;
            if (!connectParts.includes(origin)) connectParts.push(origin);
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
    let policy: {
      camera: boolean;
      microphone: boolean;
      geolocation: boolean;
      clipboardRead: boolean;
      clipboardWrite: boolean;
    } = {
      camera: false,
      microphone: false,
      geolocation: false,
      clipboardRead: false,
      clipboardWrite: false,
    };
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
    if (origin && staticAllowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (ALLOWED_ORIGINS.length > 0) {
      res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
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

  await app.register(fastifyStatic, {
    root: path.join(config.BUNDLE_STORAGE_PATH, 'builds'),
    prefix: '/builds/',
    decorateReply: false,
    redirect: true,
    index: ['index.html'],
    setHeaders: setStaticHeaders,
  });

  await app.register(fastifyStatic, {
    root: config.LOCAL_STORAGE_DIR,
    prefix: '/uploads/',
    decorateReply: false,
    index: false,
    setHeaders: (res: any) => {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    },
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
  await app.register(roomsSyncV1Routes);
  await app.register(shims);
  await app.register(uploadRoutes);
  await app.register(publishRoutes);
  await app.register(storageRoutes);
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
      reply.send({ ok: true }),
  });

  // Note: legacy /api/* handler removed; supported via onRequest prefix-strip

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    const diagDir = path.join(process.cwd(), '.diag');
    fs.mkdirSync(diagDir, { recursive: true });
    fs.appendFileSync(
      path.join(diagDir, 'notfound.log'),
      `${new Date().toISOString()} ${req.method} ${req.url}\n`
    );
    reply.code(404).send({ error: 'Not found' });
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
  const inlineLocalDevWorker = process.env.LOCAL_DEV_WORKER_INLINE === 'true';
  const buildWorker = enableWorker ? startCreatexBuildWorker() : { close: async () => {} };
  const localDevWorker = inlineLocalDevWorker ? startLocalDevWorker() : null;

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await buildWorker.close();
    if (localDevWorker) {
      await localDevWorker.close();
    }
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
      if (localDevWorker) {
        await localDevWorker.close();
      }
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
    if (localDevWorker) {
      await localDevWorker.close();
    }
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
