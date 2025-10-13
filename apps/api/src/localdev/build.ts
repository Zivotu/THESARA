import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { getLocalDevConfig, type BuildMode } from './env.js';
import { getConfig } from '../config.js';

export type Logger = (chunk: string) => void;

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyEntry(src: string, dest: string): Promise<void> {
  const stat = await fsp.stat(src);
  if (stat.isDirectory()) {
    await fsp.mkdir(dest, { recursive: true });
    const entries = await fsp.readdir(src);
    for (const entry of entries) {
      await copyEntry(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  if (stat.isFile()) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
    return;
  }
  // Skip special file types (symlinks, sockets, etc.)
}

function run(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }, log: Logger): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, shell: true });
    let killed = false;
    let to: NodeJS.Timeout | undefined;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      to = setTimeout(() => { killed = true; try { p.kill('SIGKILL'); } catch {}; reject(new Error('timeout')); }, opts.timeoutMs);
    }
    p.stdout?.on('data', (d) => log(d.toString()));
    p.stderr?.on('data', (d) => log(d.toString()));
    p.on('error', (e) => { if (to) clearTimeout(to); reject(e); });
    p.on('close', (code) => { if (to) clearTimeout(to); if (killed) return; if (code === 0) resolve(); else reject(new Error(`exit_${code}`)); });
  });
}

type PackageManager = 'pnpm' | 'npm' | 'yarn';

async function runStaticFallback(projectDir: string, log: Logger): Promise<void> {
  const distDir = path.join(projectDir, 'dist');
  const entries = await fsp.readdir(projectDir, { withFileTypes: true });

  const indexCandidates: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === 'index.html') {
      indexCandidates.push(path.join(projectDir, entry.name));
    }
  }

  let sourceRoot = projectDir;
  if (!indexCandidates.length) {
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidateDir = path.join(projectDir, entry.name);
      const candidateIndex = path.join(candidateDir, 'index.html');
      if (await pathExists(candidateIndex)) {
        sourceRoot = candidateDir;
        indexCandidates.push(candidateIndex);
        break;
      }
    }
  }

  if (!indexCandidates.length) {
    throw new Error('index_html_missing');
  }

  if (sourceRoot === distDir) {
    log('[localdev] static builder fallback -> existing dist/ detected');
    return;
  }

  await fsp.rm(distDir, { recursive: true, force: true });
  await fsp.mkdir(distDir, { recursive: true });

  const sourceEntries = await fsp.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of sourceEntries) {
    if (sourceRoot === projectDir && entry.name === 'dist') continue;
    const srcPath = path.join(sourceRoot, entry.name);
    const destPath = path.join(distDir, entry.name);
    if (entry.isDirectory()) {
      await copyEntry(srcPath, destPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(srcPath, destPath);
    }
  }

  log(`[localdev] static builder fallback -> dist/ (source=${path.relative(projectDir, sourceRoot) || '.'})`);
}

async function runNative(projectDir: string, allowScripts: boolean, log: Logger): Promise<void> {
  // Validate files
  const pkg = path.join(projectDir, 'package.json');
  await fsp.access(pkg).catch(() => { throw new Error('package.json not found'); });
  const pnpmLock = path.join(projectDir, 'pnpm-lock.yaml');
  const npmLock = path.join(projectDir, 'package-lock.json');
  const yarnLock = path.join(projectDir, 'yarn.lock');
  const hasFile = async (p: string) => !!(await fsp.access(p).then(() => true).catch(() => false));
  const hasPnpmLock = await hasFile(pnpmLock);
  const hasNpmLock = await hasFile(npmLock);
  const hasYarnLock = await hasFile(yarnLock);

  let pkgManager: PackageManager = 'npm';
  let installArgs: string[] | null = null;
  let runCommand: string[] = [];
  let reason = '';

  const packageJsonRaw = await fsp.readFile(pkg, 'utf8').catch(() => '{}');
  let packageManagerField = '';
  try {
    const parsed = JSON.parse(packageJsonRaw || '{}');
    if (typeof parsed?.packageManager === 'string') {
      packageManagerField = parsed.packageManager;
    }
  } catch {}

  const pickFromField = (field: string) => {
    if (field.startsWith('npm')) return 'npm';
    if (field.startsWith('yarn')) return 'yarn';
    if (field.startsWith('pnpm')) return 'pnpm';
    return null;
  };

  if (hasPnpmLock) {
    pkgManager = 'pnpm';
    installArgs = ['install', '--frozen-lockfile'];
    reason = 'pnpm-lock.yaml detected';
  } else if (hasNpmLock) {
    pkgManager = 'npm';
    installArgs = ['ci'];
    reason = 'package-lock.json detected';
  } else if (hasYarnLock) {
    pkgManager = 'yarn';
    installArgs = ['install', '--frozen-lockfile'];
    reason = 'yarn.lock detected';
  } else {
    const fromField = pickFromField(packageManagerField);
    if (fromField) {
      pkgManager = fromField;
      reason = `packageManager=${packageManagerField}`;
    } else {
      pkgManager = 'npm';
      reason = 'no lockfile detected -> defaulting to npm';
    }
  }

  const { DEV_BUILD_TIMEOUT_MS } = getLocalDevConfig();
  const installEnv: NodeJS.ProcessEnv = { ...process.env };
  installEnv.NODE_ENV = 'development';
  installEnv.npm_config_production = 'false';
  if (!allowScripts) {
    installEnv.npm_config_ignore_scripts = 'true';
    installEnv.YARN_IGNORE_DEPENDENCY_SCRIPTS = '1';
  }
  const buildEnv: NodeJS.ProcessEnv = { ...installEnv };
  delete buildEnv.npm_config_ignore_scripts;
  delete buildEnv.NPM_CONFIG_IGNORE_SCRIPTS;
  delete buildEnv.YARN_IGNORE_DEPENDENCY_SCRIPTS;
  // Ensure pnpm via corepack if available
  try { await run('corepack', ['enable'], { cwd: projectDir, env: installEnv }, () => {}); } catch {}

  const runTimed = (cmd: string, args: string[], env: NodeJS.ProcessEnv) =>
    run(cmd, args, { cwd: projectDir, env, timeoutMs: DEV_BUILD_TIMEOUT_MS }, log);

  let installCmd = pkgManager;
  let installCommandArgs: string[];
  if (installArgs) {
    installCommandArgs = [...installArgs];
  } else {
    switch (pkgManager) {
      case 'npm':
        installCommandArgs = ['install'];
        break;
      case 'yarn':
        installCommandArgs = ['install'];
        break;
      case 'pnpm':
      default:
        installCommandArgs = ['install'];
        break;
    }
  }

  if (!allowScripts) {
    if (pkgManager === 'npm') installCommandArgs.push('--ignore-scripts');
    if (pkgManager === 'pnpm') installCommandArgs.push('--ignore-scripts');
    if (pkgManager === 'yarn') installCommandArgs.push('--ignore-scripts');
  }

  switch (pkgManager) {
    case 'npm':
      runCommand = ['run', 'build'];
      break;
    case 'yarn':
      runCommand = ['build'];
      break;
    case 'pnpm':
    default:
      runCommand = ['run', 'build'];
      break;
  }

  log(`[localdev] ${reason} -> ${pkgManager} ${installCommandArgs.join(' ')}`);
  await runTimed(installCmd, installCommandArgs, installEnv);
  // Ensure vite is available if project references it
  try {
    const viteConfigCandidates = ['vite.config.ts','vite.config.js','vite.config.mjs','vite.config.cjs'];
    let hasViteConfig = false;
    for (const f of viteConfigCandidates) {
      try { await fsp.access(path.join(projectDir, f)); hasViteConfig = true; break; } catch {}
    }
    let mentionsVite = false;
    try {
      const pkgRaw = await fsp.readFile(path.join(projectDir, 'package.json'), 'utf8');
      const pj = JSON.parse(pkgRaw || '{}');
      const buildScript = typeof pj?.scripts?.build === 'string' ? pj.scripts.build : ' ';
      mentionsVite = /\bvite\b/.test(buildScript);
    } catch {}
    const viteBin = path.join(projectDir, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
    let viteExists = false;
    try { await fsp.access(viteBin); viteExists = true; } catch {}
    if ((hasViteConfig || mentionsVite) && !viteExists) {
      const installVite = (mgr: PackageManager) => mgr === 'yarn' ? ['add','-D','vite'] : mgr === 'pnpm' ? ['add','-D','vite'] : ['install','-D','vite'];
      log('[localdev] vite missing -> installing devDependency');
      await runTimed(pkgManager, installVite(pkgManager), buildEnv);
    }
  } catch {}
  await (async () => {
  // If Vite is referenced but missing, install it as devDependency and retry build
  try {
    await runTimed(pkgManager, runCommand, buildEnv);
  } catch (e) {
    try {
      const hasViteConfig = (await (async () => {
        const files = ['vite.config.ts','vite.config.js','vite.config.mjs','vite.config.cjs'];
        for (const f of files) {
          try { await require('node:fs').promises.access(require('node:path').join(projectDir,f)); return true; } catch {}
        }
        return false;
      })());
      const scripts = JSON.parse(await require('node:fs').promises.readFile(require('node:path').join(projectDir,'package.json'),'utf8'))?.scripts || {};
      const mentionsVite = typeof scripts.build==='string' && /\bvite\b/.test(scripts.build);
      const bin = require('node:path').join(projectDir,'node_modules','.bin', process.platform==='win32' ? 'vite.cmd' : 'vite');
      let binMissing = false;
      try { await require('node:fs').promises.access(bin); } catch { binMissing = true; }
      if ((hasViteConfig || mentionsVite) && binMissing) {
        const installVite = (mgr)=> mgr==='yarn' ? ['add','-D','vite'] : mgr==='pnpm' ? ['add','-D','vite'] : ['install','-D','vite'];
        log('[localdev] vite missing -> installing devDependency');
        await runTimed(pkgManager, installVite(pkgManager), buildEnv);
      }
    } catch {}
    await runTimed(pkgManager, runCommand, buildEnv);
  }
  }
)();
}

async function dockerAvailable(): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore', shell: true });
      p.on('error', reject);
      p.on('close', (code) => code === 0 ? resolve() : reject(new Error('docker_not_available')));
    });
    return true;
  } catch {
    return false;
  }
}

async function runDocker(projectDir: string, allowScripts: boolean, log: Logger): Promise<void> {
  const ok = await dockerAvailable();
  if (!ok) {
    log('[localdev] Docker not available, falling back to native build');
    return runNative(projectDir, allowScripts, log);
  }
  const env = { ...process.env, IGNORE_SCRIPTS: allowScripts ? '0' : '1' };
  const args = [
    'run', '--rm',
    '--memory=2g', '--cpus=1.5', '--pids-limit=256', '--cap-drop=ALL', '--security-opt', 'no-new-privileges', '--read-only',
    '--tmpfs', '/tmp:exec,mode=1777',
    '-e', `IGNORE_SCRIPTS=${allowScripts ? '0' : '1'}`,
    '-v', `${projectDir.replace(/\\/g, '/') }:/workspace`,
    'thesara/buildkit:node20'
  ];
  log(`[localdev] docker ${args.join(' ')}`);
  await run('docker', args, { cwd: projectDir, env }, log);
}

export async function runBuild(projectDir: string, mode: BuildMode, allowScripts: boolean, log: Logger): Promise<void> {
  const cfg = getConfig();
  if (cfg.PUBLISH_STATIC_BUILDER) {
    const hasPackageJson = await pathExists(path.join(projectDir, 'package.json'));
    const hasPnpmLock = await pathExists(path.join(projectDir, 'pnpm-lock.yaml'));
    if (!hasPackageJson || !hasPnpmLock) {
      log(
        `[localdev] static builder fallback (package.json=${hasPackageJson ? 'yes' : 'no'}, pnpm-lock.yaml=${hasPnpmLock ? 'yes' : 'no'})`,
      );
      await runStaticFallback(projectDir, log);
      return;
    }
  }
  if (mode === 'docker') return runDocker(projectDir, allowScripts, log);
  return runNative(projectDir, allowScripts, log);
}








