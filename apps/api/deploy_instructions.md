# Thesara – Deploy & Ops Instructions ("sveta knjiga")

> **Namjena**: Ovo je jedinstveni izvor istine za postavljanje, nadogradnju, promjene i održavanje Thesara sustava u produkciji. Sve izmjene raditi prema ovim pravilima. Ako nešto odstupa, dopuni ovaj dokument.

---

## 0. Sažetak (TL;DR)

* **Repo layout**: monorepo u `/srv/thesara/app` (pnpm workspaces)

* `apps/api` → Fastify API (port **8788**) + build worker (BullMQ)
* `apps/web` → Next.js web (port **3000**)
* **Domene**:

  * Web: **[https://thesara.space](https://thesara.space)** (Nginx → `127.0.0.1:3000`)
  * API: **[https://api.thesara.space](https://api.thesara.space)** (Nginx → `127.0.0.1:8788`)
* **Procese vodi PM2**: `thesara-api` (worker se diže unutar API-ja uz `CREATEX_WORKER_ENABLED=true`) i `thesara-web` (vidi "PM2 konfiguracija")
* **CORS**: mora dopuštati `https://thesara.space` → postavljeno u **API** i Nginx avatar proxyju.
* **Build**: `pnpm install && pnpm -r build`; API generira `apps/api/dist/server.cjs` (tsup), Web pokreće Next na 3000.
* **Konfiguracija**: tajne NIKAD u git. Koristi `*.template` / `*.example` i `.env.production` na serveru.
* **Nginx**: koristi *trailing slash* u `/api/` proxy bloku (presudno za ispravan rewrite!) i fiksni `proxy_pass` (bez varijabli).

---

## 1. Arhitektura

* **Nginx** terminira TLS i proxya na interne servise.
* **API (Fastify)** sluša na `127.0.0.1:8788`.
* **Web (Next.js)** sluša na `127.0.0.1:3000`.
* **Worker** se izvršava unutar API procesa preko BullMQ-a (aktivira se s `CREATEX_WORKER_ENABLED=true` env varijablom). Nema više zasebnog `thesara-worker` procesa.
* **Storage**: bundle/preview direktoriji na disku; API ih servira ili Nginx ih prosljeđuje do API-ja.

### Portovi i domene

| Sloj   | Domena              | Port | Bilješka              |
| ------ | ------------------- | ---- | --------------------- |
| Web    | `thesara.space`     | 3000 | Nginx proxy → Next.js |
| API    | `api.thesara.space` | 8788 | Nginx proxy → Fastify |
| Health | `/api/health`       |      | Vidi testove niže     |

---

## 2. Direktorijska struktura (server)

```
/srv/thesara/app                # git radni dir (monorepo)
  apps/
    api/                       # Fastify API
      dist/server.cjs          # build output (tsup)
      .env.production          # (nije u gitu) – tajne, konfiguracija
      prisma/schema.prisma     # model baze podataka
    web/                       # Next.js app
      .env.production          # (nije u gitu)
  ecosystem.config.js          # PM2 (nije u gitu – koristi template)
/srv/thesara/storage           # storage root (bundles, previews, uploads)
/etc/nginx/sites-available     # nginx virtual host konfiguracije
/etc/nginx/sites-enabled       # symlinkovi na active conf
/etc/thesara/creds             # npr. Firebase service account JSON
/root/.pm2                     # PM2 runtime + logovi
```

---

## 3. Varijable okoline i konfiguracijske datoteke

### 3.1. API `.env.production` (primjer – **uredi prema potrebi**)

> Putanja: `/srv/thesara/app/apps/api/.env.production` (NE ide u git)  
> Repo template: `apps/api/.env.production.example`

```env
NODE_ENV=production
PORT=8788
BUNDLE_STORAGE_PATH=/srv/thesara/storage/bundles
# BUNDLE_ROOT=/srv/thesara/storage/bundles  # alias koji je i dalje podržan
PREVIEW_STORAGE_PATH=/srv/thesara/storage/previews
# PREVIEW_ROOT=/srv/thesara/storage/previews
# CORS – ključno za web
ALLOWED_ORIGINS=https://thesara.space,https://www.thesara.space

# Stripe (primjer placeholders)
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxx
STRIPE_SUCCESS_URL=https://thesara.space/billing/success
STRIPE_CANCEL_URL=https://thesara.space/billing/cancel
PLATFORM_FEE_PERCENT=30

# Rooms V1 (SQLite/Postgres)
DATABASE_URL=postgresql://user:pass@host:5432/thesara?schema=public
JWT_SECRET=promijeni_me_u_jaku_lozinku
ARGON2_MEMORY_COST=4096
ARGON2_TIME_COST=3
ARGON2_PARALLELISM=1
RATE_LIMIT_MAX=60
ROOMS_TOKEN_TTL_SECONDS=86400
ROOMS_POLL_INTERVAL_MS=2000
PUBLISH_STATIC_BUILDER=1
PUBLISH_CSP_AUTOFIX=1
PUBLISH_CSP_AUTOFIX_STRICT=0
PUBLISH_VENDOR_MAX_MB=20
PUBLISH_VENDOR_TIMEOUT_MS=15000
PUBLISH_ROOMS_AUTOBRIDGE=1
THESARA_ROOMS_KEYS=shopping/rooms/v1,shopping/session/v1

# Firebase/Google (primjer)
GOOGLE_APPLICATION_CREDENTIALS=/etc/thesara/creds/firebase-sa.json
```

### 3.2. Web `.env.production` (primjer)

> Putanja: `/srv/thesara/app/apps/web/.env.production`  
> Repo template: `apps/web/.env.production.example`

```env
NODE_ENV=production
PORT=3000
# URL API-ja koji web koristi
NEXT_PUBLIC_API_BASE_URL=https://api.thesara.space/api
# NEXT_PUBLIC_API_URL=https://api.thesara.space/api  # stari naziv radi i dalje
```

### 3.3. PM2 `ecosystem.config.template.js`

> Datoteku držimo u git-u kao **template** (`deploy/pm2/ecosystem.config.template.js`), a na serveru kopiramo u `ecosystem.config.js` i popunimo tajne.

```js
module.exports = {
  apps: [
    {
      name: 'thesara-api',
      cwd: '/srv/thesara/app/apps/api',
      script: 'node',
      args: 'dist/server.cjs',
      env: {
        NODE_ENV: 'production',
        // Varijable se učitavaju iz .env.production, ali ovdje se mogu overrideati
        CREATEX_WORKER_ENABLED: 'true',
        GOOGLE_APPLICATION_CREDENTIALS: '/etc/thesara/creds/firebase-sa.json',
      },
      max_memory_restart: '512M',
      min_uptime: '30s',
      restart_delay: 5000
    },
    {
      name: 'thesara-web',
      cwd: '/srv/thesara/app/apps/web',
      script: 'pnpm',
      args: 'start', // pnpm start će pokrenuti `next start`
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      min_uptime: '30s',
      restart_delay: 5000
    }
  ]
};
```

> **Napomena**: `script: 'bash'` + `args: '-c ...'` je namjerno – prvo exporta `GOOGLE_APPLICATION_CREDENTIALS`, zatim starta Node. Worker se uključuje unutar API procesa preko `CREATEX_WORKER_ENABLED=true`.

---

## 4. Nginx konfiguracija (KANONSKA)

> **Pravilo**: Sites u `sites-enabled` moraju biti **symlink** na `sites-available`. Nema duplikata.
>
> **CRITICAL**: U `/api/` bloku koristi `proxy_pass http://127.0.0.1:8788/;` (sa **trailing slashom**) da `/api/foo` postane `/foo` na Fastify. To je riješilo CORS i preflight probleme.
>
> Repo primjeri konfiguracije: `deploy/nginx/api.thesara.space.example` i `deploy/nginx/thesara.space.example`.

### 4.1. API vhost – `/etc/nginx/sites-available/api.thesara.space`

```nginx
# map Origin → $thesara_cors (dopuštamo samo web domenu)
map $http_origin $thesara_cors {
  default "";
  ~^https?://(thesara\.space|www\.thesara\.space)$ $http_origin;
}

server {
  listen 443 ssl http2;
  server_name api.thesara.space;
  # ssl_certificate /etc/letsencrypt/live/api.thesara.space/fullchain.pem;
  # ssl_certificate_key /etc/letsencrypt/live/api.thesara.space/privkey.pem;

  # ---------- AVATAR PROXY ----------
  # /api/avatar/... → /avatar/... pa onda proxy prema Fastify
  location ^~ /api/avatar/ { rewrite ^/api/(.*)$ /$1 last; }

  location ^~ /avatar/ {
    proxy_pass http://127.0.0.1:8788$request_uri;  # eksplicitno
    proxy_http_version 1.1; proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_redirect off;

    add_header Cross-Origin-Resource-Policy "cross-origin" always;
    add_header Vary "Origin" always;
    add_header Access-Control-Allow-Origin $thesara_cors always;
    add_header Access-Control-Allow-Credentials "true" always;
  }

  # ---------- API (sva ostala /api/*) ----------
  location ^~ /api/ {
    proxy_pass http://127.0.0.1:8788/;  # TRAILING SLASH je ključan
    proxy_http_version 1.1; proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_redirect off;
  }

  # ---------- Fallback (health i dr.) ----------
  location / {
    proxy_pass http://127.0.0.1:8788;   # bez završne /
    proxy_http_version 1.1; proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_redirect off;
  }
}

# HTTP → HTTPS (+ ACME)
server {
  listen 80;
  server_name api.thesara.space;
  location ^~ /.well-known/acme-challenge/ { root /var/www/html; }
  return 301 https://$host$request_uri;
}
```

### 4.2. Web vhost – `/etc/nginx/sites-available/thesara.space`

```nginx
server {
  listen 443 ssl http2;
  server_name thesara.space;
  # ssl_certificate /etc/letsencrypt/live/thesara.space/fullchain.pem;
  # ssl_certificate_key /etc/letsencrypt/live/thesara.space/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;  # Next.js
    proxy_http_version 1.1; proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_redirect off;
  }

  # Cache za Next statiku (po potrebi)
  location ^~ /_next/static/ { expires 30d; access_log off; }
}

server {
  listen 80;
  server_name thesara.space;
  location ^~ /.well-known/acme-challenge/ { root /var/www/html; }
  return 301 https://$host$request_uri;
}
```

### 4.3. Aktivacija (symlink!)

```bash
sudo ln -sf /etc/nginx/sites-available/api.thesara.space /etc/nginx/sites-enabled/api.thesara.space
sudo ln -sf /etc/nginx/sites-available/thesara.space     /etc/nginx/sites-enabled/thesara.space

sudo nginx -t && sudo systemctl reload nginx
```

> Ako vidiš „conflicting server name … ignored“ → postoji duplicirani vhost. Ukloni duplikat iz `sites-enabled` (ili višak .bak datoteka).

---

## 5. PM2 – upravljanje procesima

### 5.1. Start/Restart/Status

```bash
cd /srv/thesara/app
pm2 start ecosystem.config.js   # prvi put
pm2 restart thesara-api
pm2 restart thesara-web
pm2 list
pm2 logs thesara-api --lines 50  # uključuje i output build workera
pm2 logs thesara-web --lines 50
```

### 5.2. Autostart nakon reboota

```bash
pm2 startup systemd   # ispisat će naredbu – kopiraj i pokreni je
pm2 save
`

> **

> **Rooms auto-bridge**: pobrini se da `.env.production` ima `PUBLISH_ROOMS_AUTOBRIDGE=1` i `THESARA_ROOMS_KEYS=shopping/rooms/v1,shopping/session/v1`. Naredba `pnpm --filter @loopyway/api exec prisma db push` kreira/azurira tablicu `RoomBridge` (koriste je rute `/rooms/v1/bridge/*`), a publish pipeline automatski generira `thesara-rooms-config.js` i `thesara-rooms-bridge.js` kada ZIP koristi dopuštene localStorage ključeve.

### 6.3. Kada mijenjaš Nginx

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 7. Zdravstveni testovi (smoke tests)

### 7.1. API upstream (direktno na Fastify)

```bash
curl -sSI http://127.0.0.1:8788/health  # očekuješ 200
```

### 7.2. Kroz Nginx (health + CORS)

```bash
curl -sSI https://api.thesara.space/api/health
curl -i "https://api.thesara.space/api/listings" -H "Origin: https://thesara.space" | sed -n '1,25p'
```

Trebaš vidjeti `HTTP/2 200` i `access-control-allow-origin: https://thesara.space`.

### 7.3. Preflight OPTIONS

```bash
curl -i -X OPTIONS "https://api.thesara.space/api/listings" \
  -H "Origin: https://thesara.space" \
  -H "Access-Control-Request-Method: GET" | sed -n '1,25p'
```

Trebaš vidjeti `HTTP/2 204` i CORS headere.

### 7.4. Avatar proxy

```bash
curl -i "https://api.thesara.space/api/avatar/test?url=https://example.com/x.png"
```

Treba `HTTP/2 200` i `content-type: image/*`.

---

## 8. Tipični problemi i rješenja

### 8.1. **CORS: browser javlja "Missing Allow Origin" ili 500 na OPTIONS**

* Uzrok: Nginx krivo rewrite-a `/api/…` ili sam presreće OPTIONS.
* Rješenje: U `/api/` bloku koristi **`proxy_pass http://127.0.0.1:8788/;`** (sa završnom `/`). Ne dodavati ručne CORS headere u taj blok – Fastify ih već šalje.

### 8.2. **Nginx error: `invalid URL prefix`**

* Uzrok: `proxy_pass` bez URI dijela ili pogrešan rewrite redoslijed.
* Rješenje: Za avatar koristi dvostruki blok:

  1. `location ^~ /api/avatar/ { rewrite ^/api/(.*)$ /$1 last; }`
  2. `location ^~ /avatar/ { proxy_pass http://127.0.0.1:8788$request_uri; … }`

### 8.3. **502 Bad Gateway na webu**

* Uzrok: Next.js nije pokrenut (port 3000) ili PM2 ga ne vodi.
* Rješenje: `pm2 restart thesara-web`; provjeri `curl -sSI http://127.0.0.1:3000`.

### 8.4. **`Cannot find module '/srv/.../dist/server.cjs'` u PM2**

* Uzrok: API nije buildan ili PM2 pokazuje na krivu putanju.
* Rješenje: `pnpm -r build`, provjeri `ls -lh apps/api/dist/server.cjs`, pa `pm2 restart thesara-api`.

### 8.5. **`conflicting server name … ignored` pri `nginx -t`**

* Uzrok: Duplicirani vhost (npr. stari backup u `sites-enabled`).
* Rješenje: U `sites-enabled` mora biti **samo symlink** na datoteku u `sites-available`.

---

## 9. Logovi i dijagnostika

```bash
# Nginx
sudo tail -n 100 /var/log/nginx/error.log
sudo tail -n 100 /var/log/nginx/access.log

# PM2 / procesi
pm2 list
pm2 logs thesara-api --lines 50  # uključuje build queue worker
pm2 logs thesara-web --lines 50

# Brzi testovi
curl -sSI http://127.0.0.1:8788/health
curl -sSI https://api.thesara.space/api/health
curl -i "https://api.thesara.space/api/listings" -H "Origin: https://thesara.space" | sed -n '1,25p'
```

---

## 10. Pravila za git i tajne

* U repo stavljamo **template** konfiguracije, ne stvarne tajne:

  * `deploy/pm2/ecosystem.config.template.js` → na serveru kopiramo u `ecosystem.config.js`
  * `.env.example`, `apps/api/.env.production.example`, `apps/web/.env.production.example` → na serveru `*.env.production`
  * `deploy/nginx/*.example` → kopiramo u `/etc/nginx/sites-available/*`
* `.gitignore` mora isključiti: `ecosystem.config.js`, `*.env.production`, `/etc/thesara/creds/*` itd.
* Svaku promjenu dokumentirati ovdje.

---

## 11. Backup & DR (kratko)

* Jednostavni snapshot skript (vidi fazu 2) arhivira:

  * `/srv/thesara/app`, `/etc/nginx/sites-available`, `/etc/thesara/creds`, `/var/log/nginx`, `~/.pm2`.
* Restore: raspakirati arhivu, `pnpm install`, `pnpm -r build`, postaviti Nginx symlinkove, `pm2 start`, `pm2 save`.

---

## 12. Trenutno stanje (2025-10-11)

* **Radi**: Web 3000 (PM2), API 8788 (PM2), CORS među domenama, avatar proxy preko Nginxa, listings endpoint, health.
* **Fixovi primijenjeni**:

  * `/api/` proxy s trailing slashom.
  * Avatar dvostruki blok (rewrite + proxy s `$request_uri`).
  * Uklonjeni duplikati vhostova (`sites-enabled` su symlinkovi).

---

## 13. Dodatne napomene

* Node.js: v20.x (trenutno 20.19.5). `pnpm` kroz `corepack enable`.
* Nakon promjena u `apps/api/src/**`: uvijek `pnpm -r build` prije PM2 restarta.
* Ako se mijenja CORS domena: ažurirati **i** API `.env.production` (`ALLOWED_ORIGINS`) **i** Nginx `map` blok.

---

## 14. Priručni one-lineri

```bash
# Health
curl -sSI http://127.0.0.1:8788/health
curl -sSI https://api.thesara.space/api/health

# CORS GET
curl -i "https://api.thesara.space/api/listings" -H "Origin: https://thesara.space" | sed -n '1,25p'

# CORS preflight
curl -i -X OPTIONS "https://api.thesara.space/api/listings" \
  -H "Origin: https://thesara.space" \
  -H "Access-Control-Request-Method: GET" | sed -n '1,25p'

# Avatar
curl -i "https://api.thesara.space/api/avatar/test?url=https://example.com/x.png"

# PM2
pm2 list && pm2 logs thesara-api --lines 30

# Nginx
sudo nginx -t && sudo systemctl reload nginx
sudo tail -n 100 /var/log/nginx/error.log
```
