import { join } from 'node:path';
import { fileExists, dirExists } from '../src/lib/fs.js';
import { getConfig } from '../src/config.js';

const args = process.argv.slice(2);
let id: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--id') {
    id = args[i + 1];
    break;
  }
}

if (!id) {
  console.error('Usage: pnpm --filter @loopyway/api check:bundle -- --id <buildId>');
  process.exit(1);
}

(async () => {
  const cfg = getConfig();
  const bundleDir = join(cfg.BUNDLE_STORAGE_PATH, 'builds', id!, 'bundle');
  if (!(await dirExists(bundleDir))) {
    console.error('bundle directory not found:', bundleDir);
    process.exit(1);
  }
  for (const f of ['index.html', 'app.js']) {
    if (!(await fileExists(join(bundleDir, f)))) {
      console.error('missing required file:', f);
      process.exit(1);
    }
  }
  console.log('bundle ok');
})();
