# API Billing Setup

Set the following environment variables before running the API:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SUCCESS_URL`
- `STRIPE_CANCEL_URL`
- `PLATFORM_FEE_PERCENT` (0-1)
- `PRICE_MIN` (default: 0) – minimum allowed product price in USD
- `PRICE_MAX` (default: 1000) – maximum allowed product price in USD
- `GOLD_PRICE_ID` – required only when Gold subscriptions are offered
- `NOADS_PRICE_ID` – required only when No-Ads add-ons are offered
- `GOLD_MAX_APPS_PER_USER` – max apps for Gold users (default: 10)
- `FREE_MAX_APPS_PER_USER` – max apps for free users (default: 2)
- `STRIPE_LOGO_URL`
- `STRIPE_PRIMARY_COLOR`
- `PUBLIC_BASE` – base URL for redirects (fallback for Stripe URLs)

## Configuration examples

### Local development

```env
WEB_BASE=http://localhost:3000
STRIPE_SUCCESS_URL=http://localhost:3000/billing/success
```

### Production

```env
WEB_BASE=https://app.example.com
STRIPE_SUCCESS_URL=https://app.example.com/billing/success
```

Create Stripe **Price** objects for Gold and NoAds in the Dashboard (Products → Add product). After adding a price, copy its `Price ID` from the product page and set `GOLD_PRICE_ID` or `NOADS_PRICE_ID` accordingly.

## Testing Webhooks

Use the Stripe CLI to forward events:

```bash
stripe listen --forward-to localhost:8788/billing/stripe/webhook
```

Then run the API with `pnpm --filter @loopyway/api dev`.

## Rooms V1 (shared shopping / room sync)

Backend service for mini aplikacije s "sobama"/listama nalazi se u paketu `rooms/v1`.

### Migracije i Prisma

- Lokalne migracije (SQLite dev baza):

  ```bash
  cd apps/api
  pnpm exec prisma db push
  pnpm exec prisma generate
  ```

- Produkcija (Postgres/SQLite): postavi `DATABASE_URL` i pokreni `pnpm exec prisma db push` prilikom deploya.

Migracije su u `prisma/migrations/` (`0001_rooms_init`).

### Ključne env varijable

- `DATABASE_URL` – putanja do baze (`file:./dev.db` u lokalu).
- `JWT_SECRET` (obavezno u produkciji) – potpisivanje room session tokena.
- `ARGON2_MEMORY_COST`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM` – parametri za hash PIN‑a (default: 4096 / 3 / 1).
- `RATE_LIMIT_MAX` – globalni limit na room rute (default 60/min).
- `ROOMS_POLL_INTERVAL_MS` – preporučeni polling interval (info, koristi ga SDK).
- `ROOMS_TOKEN_TTL_SECONDS` – trajanje room JWT‑a (default 24h).

Sve su dokumentirane u `.env.example`.

### API rute (`/rooms/v1`)

- `POST /rooms/v1` → kreira sobu (`{ roomCode, pin, name? }`), vraća `token`, `room`, `member` (owner).
- `POST /rooms/v1/:roomCode/join` → pridruži se sobi (PIN provjera), vraća `token`, `member`.
- `GET /rooms/v1/:roomCode` → dohvat stanja (zahtijeva `Authorization: Bearer <room-token>`). Podržava `?since=<ms>` i `?sinceVersion=<int>`.
- `POST /rooms/v1/:roomCode/items` → dodaj stavku (zahtijeva `If-Match` trenutnog room `version` + opcionalno `x-idempotency-key`).
- `PATCH /rooms/v1/:roomCode/items/:itemId` → izmjene / toggle kupovine (`If-Match`).
- `DELETE /rooms/v1/:roomCode/items/:itemId` → ukloni stavku (`If-Match`).
- `POST /rooms/v1/:roomCode/finalize` → finaliziraj kupovinu (kupljene stavke idu u povijest, `If-Match`, podržava `x-idempotency-key`).
- `POST /rooms/v1/:roomCode/rotate-pin` → promijeni PIN (samo owner, `If-Match`).

Svi mutirajući pozivi zahtijevaju `If-Match: <room.version>` (optimistička konkurentnost). Idempotentni POST‑ovi primaju `x-idempotency-key` (do 120 znakova).

### JWT i sesije

- Backend potpisuje per-room JWT (`app.signRoomToken`). Payload: `{ roomId, memberId, role, name?, tokenVersion }`.
- `tokenVersion` se povećava pri `rotate-pin`, što automatski poništava stare tokene.

### Metrics & docs

- Prometheus: `GET /metrics` (standardni `prom-client` metrički set + httpRequestDuration/httpRequestsTotal labelirano po metodi i ruti).
- OpenAPI/Swagger: `GET /docs` (Fastify Swagger UI s osnovnim opisima ruta i shema).

### Rooms auto-bridge (publish pipeline)

- `PUBLISH_ROOMS_AUTOBRIDGE=1` aktivira automatsko povezivanje aplikacija koje koriste localStorage kljuÄeve definirane u `THESARA_ROOMS_KEYS` (comma-separated lista, npr. `shopping/rooms/v1,shopping/session/v1`).
- Publish pipeline skenira bundle (JS/HTML) i traÅ¾i navedene kljuÄeve. Kada pronaÄ‘e barem jedan:
  - uklanja originalne lokalne `<script src="...">` entry-je i pamti njihove atribute kako bi se kasnije injektali redom,
  - generira `thesara-rooms-config.js` s konfiguracijom (kljuÄevi, popis entry skripti, opcionalni API base),
  - generira `thesara-rooms-bridge.js` koji poziva `/rooms/v1/bridge/load` i `/rooms/v1/bridge/save`, puni localStorage i presreÄ‡e `setItem`/`removeItem` za sinkronizaciju prema backendu,
  - nakon inicijalnog loada ponovno injecta originalni bundle (podrÅ¾an je viÅ¡e-skriptni setup i hashirani nazivi).
- Prije deploya **obavezno** pokrenuti `pnpm --filter @loopyway/api exec prisma db push` kako bi Prisma kreirala `RoomBridge` tablicu koju bridge rute koriste za pohranu stanja.

### SSE (Phase B)

- `RoomsService.emitRoomEvent(...)` je stub koji će se koristiti za SSE/WebSocket broadcast u sljedećem PR-u.
- Trenutni klijenti trebaju polling interval (~2s) s `?sinceVersion` i `If-Match` zaglavljima.

## Creator onboarding flow

Creators use **Stripe Connect Standard** accounts. Call
`POST /billing/connect/onboard` with `{ creatorId, returnUrl }` to receive an onboarding URL. `returnUrl` should point to the creator's finances page (e.g. `https://app.example.com/u/<handle>/finances`). After a creator finishes onboarding, Stripe redirects to the provided `returnUrl`; if the flow is restarted, `STRIPE_CANCEL_URL` (or
`PUBLIC_BASE`) is used.

## Troubleshooting

If preview refresh fails or the player shows a blank page, see `docs/troubleshooting.md` for common causes and fixes (owner/admin checks, bundle not found, React hook crash hints, SES/lockdown issues).

## Local‑Dev Static CI/CD (ZIP → Build → Preview)

- Redis: `pnpm dev:redis` (root) starts `redis:7-alpine` via `docker-compose.dev.yml`.
- Dev runner: `pnpm dev` (root) runs API and the local build worker in parallel.

Environment (apps/api/.env.example):
- `THESARA_ENV=local`
- `REDIS_URL=redis://127.0.0.1:6379`
- `THESARA_STORAGE_ROOT=./.devdata` (uploads, build-tmp, hosted-apps, logs)
- `THESARA_PUBLIC_BASE=http://localhost:8788`
- `DEV_BUILD_MODE=native` (optional: `docker` if Docker is available)

Endpoints (available on the API server):
- `POST /apps/:appId/upload` and `POST /api/apps/:appId/upload` — attach a Vite/React ZIP; returns `{ jobId }`.
- `GET /apps/:appId/build-status/:jobId` and `GET /api/apps/:appId/build-status/:jobId` — returns `status` and `log` tail if failed.
- `GET /preview/:appId/*` — serves static from `.devdata/hosted-apps/<appId>/dist` with SPA fallback.
- `GET /api/health` — `{ ok: true }`.

Worker behavior:
- Unzips into `.devdata/build-tmp/<appId>-<jobId>/`.
- Builds via `pnpm install --frozen-lockfile` and `pnpm run build` (native), or executes docker image `thesara/buildkit:node20` when `DEV_BUILD_MODE=docker` and Docker is present.
- Requires `pnpm-lock.yaml` and expects a `dist/` output.
- Deploys atomically to `.devdata/hosted-apps/<appId>/dist`.
- Logs streamed to `.devdata/logs/<appId>/<jobId>.log`.
- Audits: ZIP SHA256 and `dist.tar.gz` SHA256 saved in same log directory.

Notes:
- `@fastify/multipart` is registered; uploads use `req.file()`.
- `appId` must match `^[a-z0-9-]{1,63}$`.
- For Docker builds locally, ensure you have built the image `thesara/buildkit:node20` (see VPS pack section) or set `DEV_BUILD_MODE=native`.

### CSP auto-fix & vendorization (Phase 2)

- Static fallback (`PUBLISH_STATIC_BUILDER=1`): ZIP bez `package.json` + `pnpm-lock.yaml` kopira se u `dist/` umjesto pokretanja native builda.
- CSP transformacija (`PUBLISH_CSP_AUTOFIX`, zadano 1): uklanja `<base>`, inline `<script>` sprema u `inline-<hash>.js`, bundla `type="module"` u jedinstveni `app.js`, te vendorizira CDN skripte/stylesheetove u `vendor/<domena>/<putanja>-<hash>.js|css` (limit `PUBLISH_VENDOR_MAX_MB`, timeout `PUBLISH_VENDOR_TIMEOUT_MS`).
- Lint izvještaj `transform_report_v1.json` evidentira inline stilove i event handlere; u strict modu (`PUBLISH_CSP_AUTOFIX_STRICT=1`) inline handleri prekidaju build.
- Artefakti: `bundle_original.zip`, `bundle_transformed.zip`, `transform_report_v1.json`, kao i postojeći `imports_v1.json` i `manifest_v1.json`.
- Downloader prihvaća samo http/https, ukupno do 20 MB (zadano) i 15 s timeout po resursu; svaka transformacija se logira u worker outputu radi audita.
