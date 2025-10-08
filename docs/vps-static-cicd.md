# Thesara VPS Static CI/CD Pack (copy–paste)

Target: Ubuntu 24.04, Node 20, Fastify API, Redis/BullMQ, Docker, Nginx.

Use this guide when you’re ready to provision the VPS. Local dev works without this.

## FAZA 0 — Priprema VPS-a

```bash
# 0) OS i korisnik
sudo apt update && sudo apt -y upgrade
sudo adduser thesara --gecos "" --disabled-password
sudo usermod -aG sudo thesara

# 1) UFW
sudo apt -y install ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# 2) Docker (repo)
sudo apt -y install ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker thesara

# (opcija) Rootless Docker
sudo apt -y install uidmap dbus-user-session
sudo -iu thesara dockerd-rootless-setuptool.sh install || true

# 3) Nginx
sudo apt -y install nginx

# 4) FS struktura
sudo mkdir -p /srv/thesara/{uploads,build-tmp,hosted-apps,logs}
sudo chown -R thesara:thesara /srv/thesara
sudo chmod -R 750 /srv/thesara
```

Optional UFW app profile: `/etc/ufw/applications.d/thesara-web`:

```
[Thesara Web]
title=Thesara Web (HTTP/HTTPS)
description=Nginx reverse proxy for Thesara static apps
ports=80,443/tcp
```

## FAZA 1 — Build slika

`/opt/thesara/build-image/Dockerfile`

```Dockerfile
FROM node:20-slim
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
ENV NODE_ENV=production \
    PNPM_HOME=/root/.local/share/pnpm \
    IGNORE_SCRIPTS=1
WORKDIR /workspace
COPY build.sh /usr/local/bin/build.sh
RUN chmod +x /usr/local/bin/build.sh
ENTRYPOINT ["/usr/local/bin/build.sh"]
```

`/opt/thesara/build-image/build.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /workspace
if [[ ! -f package.json ]]; then echo "FAILURE: package.json not found"; exit 2; fi
if [[ ! -f pnpm-lock.yaml ]]; then echo "FAILURE: pnpm-lock.yaml required"; exit 3; fi
if [[ "${IGNORE_SCRIPTS:-1}" == "1" ]]; then export npm_config_ignore_scripts=true; fi
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile
pnpm run build
[[ -d dist ]] || { echo "FAILURE: dist/ not produced"; exit 4; }
echo "SUCCESS"
```

Build image:

```bash
sudo mkdir -p /opt/thesara/build-image
# copy the two files above
cd /opt/thesara/build-image
sudo docker build -t thesara/buildkit:node20 .
```

## FAZA 2 — Worker (BullMQ)

- Worker: reads ZIP, unpacks to `/srv/thesara/build-tmp/<appId>-<jobId>/`, runs `docker run \-v tmp:/workspace thesara/buildkit:node20`, logs to `/srv/thesara/logs/<appId>/<jobId>.log`.
- On success, proceeds to FAZA 3 (deploy). Always cleans temp.

Security flags for `docker run`:

```
--memory=2g --cpus=1.5 --pids-limit=256 --cap-drop=ALL \
--read-only --tmpfs /tmp:exec,mode=1777 --security-opt no-new-privileges
```

## FAZA 3 — Deploy + Nginx

`/etc/nginx/sites-available/thesara.conf`

```nginx
map $host $app_id {
  ~^(?<sub>[^.]+)\.thesara\.space$ $sub;
  default "";
}

server { listen 80; server_name *.thesara.space; return 301 https://$host$request_uri; }

server {
  listen 443 ssl http2;
  server_name *.thesara.space;
  # ssl_certificate /etc/letsencrypt/live/thesara.space/fullchain.pem;
  # ssl_certificate_key /etc/letsencrypt/live/thesara.space/privkey.pem;

  if ($app_id = "") { return 404; }
  root /srv/thesara/hosted-apps/$app_id/dist;
  index index.html;

  add_header X-Frame-Options SAMEORIGIN always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer-when-downgrade always;
  add_header Permissions-Policy "geolocation=(), microphone=()" always;
  add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:" always;

  location ~* \.(?:js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$ { expires 30d; access_log off; try_files $uri =404; }
  location / { try_files $uri /index.html; }
}
```

Enable:

```bash
sudo ln -s /etc/nginx/sites-available/thesara.conf /etc/nginx/sites-enabled/thesara.conf || true
sudo nginx -t && sudo systemctl reload nginx
```

## FAZA 4 — Notes

- Default `IGNORE_SCRIPTS=1` for safety; allow per-job override only if trusted.
- Require `pnpm-lock.yaml` to mitigate supply-chain drift.
- Save SHA256 of uploaded ZIP and `dist.tar.gz` in logs for auditing.
- Scale workers horizontally — shared FS or object storage for artifacts.

