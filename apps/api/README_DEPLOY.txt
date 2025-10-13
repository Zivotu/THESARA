UPLOAD CONTENTS TO: /home/conexa/thesara/api-standalone

1) Upload: dist/ , package.json , README_DEPLOY.txt
2) U cPanel -> Setup Node.js App (api.thesara.space):
   - Startup file: dist/server.mjs
   - Run NPM Install (instalira SAMO vanjske pakete)
   - Pokreni pnpm exec prisma migrate deploy (DATABASE_URL mora biti postavljen)
   - Restart
3) Health: https://api.thesara.space/health

Ako install zapne zbog memorije: u terminalu aktiviraj env i pokreni
  npm ci --omit=dev --omit=optional
Ako koristis puppeteer: export PUPPETEER_SKIP_DOWNLOAD=1 (ili ga ostavi kao optional dep).
Za prvotno seedanje (trenutno noop): pnpm exec prisma db seed
