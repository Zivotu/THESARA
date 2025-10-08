#!/usr/bin/env node
// Simple cross-platform dev runner: starts API server and local-dev worker in parallel
// Also ensures Redis is up via separate script `pnpm run dev:redis` before running this.

import { spawn } from 'node:child_process';

function run(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  p.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[dev] ${cmd} exited with ${code}`);
      process.exit(code || 1);
    }
  });
  return p;
}

const procs = [];

// API server
procs.push(run('pnpm', ['-C', 'apps/api', 'dev']));

// Local-dev worker
procs.push(run('pnpm', ['-C', 'apps/api', 'dev:worker']));

function shutdown() {
  for (const p of procs) {
    try { p.kill('SIGINT'); } catch {}
  }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

