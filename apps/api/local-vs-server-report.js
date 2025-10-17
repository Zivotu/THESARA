#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const SNAPSHOT_FILE = 'server_snapshot.txt';
const KEY_FILES = [
  'apps/api/src/rateLimit.ts',
  'apps/api/src/safePublish.ts',
  'apps/api/tsup.config.ts',
  'apps/api/tsup.config.cjs',
  'apps/api/package.json',
  'apps/web/package.json',
  'package.json',
  'apps/web/lib/jwt-server.ts',
  'apps/web/app/api/jwt/route.ts',
  'ecosystem.config.js',
  'apps/api/dist/server.cjs',
];

const results = {
  git: {},
  files: [],
  sourceChecks: {},
  distChecks: {},
  summary: [],
};

async function runCommand(command) {
  return new Promise((resolve) => {
    exec(command, (err, stdout, stderr) => {
      if (err) {
        resolve({ error: err, stdout: '', stderr });
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

function getFileSha256(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

function parseSnapshot() {
  const serverHashes = new Map();
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    return serverHashes;
  }
  const content = fs.readFileSync(SNAPSHOT_FILE, 'utf8');
  const lines = content.split('\n');
  const regex = /^([0-9a-f]{64})\s+(.+)$/;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      const [, hash, filePath] = match;
      // Normalize path for comparison
      const normalizedPath = path.normalize(filePath.trim());
      serverHashes.set(normalizedPath, hash);
    }
  }
  return serverHashes;
}

function recursiveGrep(dir, pattern) {
  const found = [];
  if (!fs.existsSync(dir)) return found;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...recursiveGrep(fullPath, pattern));
    } else if (entry.isFile()) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes(pattern)) {
        found.push(path.relative(process.cwd(), fullPath));
      }
    }
  }
  return found;
}

async function checkGit() {
  results.git.branch = (await runCommand('git rev-parse --abbrev-ref HEAD')).stdout;
  results.git.commit = (await runCommand('git log -1 --oneline')).stdout;
  const status = (await runCommand('git status --porcelain')).stdout;
  results.git.isDirty = status.length > 0;
  results.git.status = status || 'Clean';
}

async function checkFiles(serverHashes) {
  for (const file of KEY_FILES) {
    const localHash = getFileSha256(file);
    const serverHash = serverHashes.get(path.normalize(file));
    const status =
      !localHash && !serverHash
        ? 'MISSING_BOTH'
        : !localHash
        ? 'MISSING_LOCAL'
        : !serverHash
        ? 'MISSING_SERVER'
        : localHash === serverHash
        ? 'MATCH'
        : 'MISMATCH';
    results.files.push({ file, status, localHash, serverHash });
  }
}

async function checkSource() {
  // npm audit check
  results.sourceChecks.auditInSrc = recursiveGrep('apps/api/src', 'npm audit --audit-level=high');

  // rateLimit.ts bug check
  const rateLimitPath = 'apps/api/src/rateLimit.ts';
  if (fs.existsSync(rateLimitPath)) {
    const content = fs.readFileSync(rateLimitPath, 'utf8');
    results.sourceChecks.rateLimitBug = content.includes('doc(.key)');
  } else {
    results.sourceChecks.rateLimitBug = 'MISSING';
  }

  // tsup config check
  results.sourceChecks.tsupTsExists = fs.existsSync('apps/api/tsup.config.ts');
  results.sourceChecks.tsupCjsExists = fs.existsSync('apps/api/tsup.config.cjs');

  // package.json build script
  const apiPkgPath = 'apps/api/package.json';
  if (fs.existsSync(apiPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(apiPkgPath, 'utf8'));
    results.sourceChecks.apiBuildScript = pkg.scripts?.build || 'Not found';
  } else {
    results.sourceChecks.apiBuildScript = 'MISSING';
  }
}

async function checkDist() {
  const distPath = 'apps/api/dist/server.cjs';
  if (!fs.existsSync(distPath)) {
    results.distChecks.distFileExists = false;
    return;
  }
  results.distChecks.distFileExists = true;
  const content = fs.readFileSync(distPath, 'utf8');

  const guardString = '[ -f package.json ] && (npm i --package-lock-only --no-audit && npm audit --audit-level=high || true) || true';
  results.distChecks.hasGuardString = content.includes(guardString);

  const rawAuditString = 'npm audit --audit-level=high';
  // Check for raw audit string that is NOT the guard string
  results.distChecks.hasRawAudit = content.replace(guardString, '').includes(rawAuditString);
}

function generateSummary() {
    if (results.sourceChecks.auditInSrc?.length > 0) {
        results.summary.push("`npm audit` call in `safePublish.ts` should be guarded. The server version has a fix.");
    }
    if (results.sourceChecks.rateLimitBug === true) {
        results.summary.push("`rateLimit.ts` contains a bug `doc(.key)`. The server version likely has this fixed to `doc(key)`.");
    }
    if (results.sourceChecks.tsupTsExists && !results.sourceChecks.tsupCjsExists) {
        results.summary.push("Local `tsup.config.ts` exists but server uses `tsup.config.cjs`. Rename the file and update `apps/api/package.json` build script.");
    }
    if (results.files.some(f => f.file === 'apps/api/src/safePublish.ts' && f.status === 'MISMATCH')) {
        results.summary.push("`safePublish.ts` has changed on the server. It likely contains fixes for CSP, artifact generation, and a safer `npm audit` execution.");
    }
    if (results.summary.length === 0) {
        results.summary.push("No major discrepancies found that require immediate action. Local state seems to align with server fixes.");
    }
}

function printReport() {
  console.log(`# Local vs. Server State Report`);
  console.log(`> Generated: ${new Date().toISOString()}\n`);

  console.log(`## Git Status`);
  console.log(`- **Branch**: \`${results.git.branch}\``);
  console.log(`- **Latest Commit**: \`${results.git.commit}\``);
  console.log(`- **Working Directory**: ${results.git.isDirty ? 'DIRTY' : 'Clean'}`);
  if (results.git.isDirty) {
    console.log('```');
    console.log(results.git.status);
    console.log('```');
  }
  console.log('');

  console.log(`## File Hash Comparison`);
  console.log(`| Status | File |`);
  console.log(`|:---|:---|`);
  results.files.forEach(({ file, status }) => {
    const icon = {
      MATCH: '✅',
      MISMATCH: '❌',
      MISSING_LOCAL: '❓ (Local)',
      MISSING_SERVER: '❓ (Server)',
      MISSING_BOTH: '➖',
    }[status];
    console.log(`| ${icon} ${status} | \`${file}\` |`);
  });
  console.log('');

  console.log(`## Source Code Checks`);
  console.log(`- **\`npm audit --audit-level=high\` in \`apps/api/src\`**:`);
  if (results.sourceChecks.auditInSrc.length > 0) {
    console.log(`  - 🚨 Found in:`);
    results.sourceChecks.auditInSrc.forEach(file => console.log(`    - \`${file}\``));
  } else {
    console.log(`  - ✅ Not found.`);
  }

  console.log(`- **Bug in \`apps/api/src/rateLimit.ts\` (\`doc(.key)\`)**:`);
  if (results.sourceChecks.rateLimitBug === 'MISSING') {
    console.log(`  - ❓ File not found.`);
  } else {
    console.log(`  - ${results.sourceChecks.rateLimitBug ? '🚨 Bug found.' : '✅ Bug not found.'}`);
  }

  console.log(`- **TSUP Config Files**:`);
  console.log(`  - \`apps/api/tsup.config.ts\` exists: ${results.sourceChecks.tsupTsExists ? '✅ Yes' : '❌ No'}`);
  console.log(`  - \`apps/api/tsup.config.cjs\` exists: ${results.sourceChecks.tsupCjsExists ? '✅ Yes' : '❌ No'}`);
  console.log(`- **\`apps/api/package.json\` build script**: \`${results.sourceChecks.apiBuildScript}\`\n`);

  console.log(`## Distributable (\`apps/api/dist/server.cjs\`) Checks`);
  if (!results.distChecks.distFileExists) {
    console.log('- ❓ File not found. Run `pnpm -r build` in the repo root.');
  } else {
    console.log(`- **Guarded \`npm audit\` string found**: ${results.distChecks.hasGuardString ? '✅ Yes' : '❌ No'}`);
    console.log(`- **Raw (unguarded) \`npm audit\` string found**: ${results.distChecks.hasRawAudit ? '🚨 Yes' : '✅ No'}`);
  }
  console.log('');

  console.log(`## Summary: What to change locally to match server fixes`);
  if (results.summary.length > 0) {
      results.summary.forEach(item => console.log(`- ${item}`));
  } else {
      console.log("- No specific actions identified based on checks.");
  }
  console.log('');
}

async function main() {
  try {
    const serverHashes = parseSnapshot();
    if (serverHashes.size === 0) {
        console.error(`Warning: Could not read or parse '${SNAPSHOT_FILE}'. File hash comparison will be incomplete.`);
    }

    await checkGit();
    await checkFiles(serverHashes);
    await checkSource();
    await checkDist();
    generateSummary();

    printReport();
  } catch (error) {
    console.error('An error occurred while generating the report:', error);
    process.exit(1);
  }
  process.exit(0);
}

main();