import EventEmitter from 'node:events';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { analyzeExports } from './builder/build.js';
import { cdnImportPlugin } from './builder/cdnPlugin.js';
import { buildTailwindCSS } from './builder/tailwind.js';
import { PREVIEW_ROOT, getBuildDir } from './paths.js';
import { getConfig } from './config.js';
import {
  initBuild,
  updateBuild,
  readBuild,
  listBuilds,
  applyPipelineResult,
  type BuildRecord,
  type BuildState,
} from './models/Build.js';
import { SafePublishPipeline } from './safePublish.js';
import { saveBuildData } from './db/builds.js';


const { CDN_ALLOW, CDN_PIN, CDN_BASE, EXTERNAL_HTTP_ESM, ALLOW_ANY_NPM } = getConfig() as any;

interface Job {
  id: string;
  controller: AbortController;
  emitter: EventEmitter;
  log?: { info: (...args: any[]) => void; error?: (...args: any[]) => void };
}

const jobs = new Map<string, Job>();
const queue: Job[] = [];
let running = false;

const TERMINAL_STATES: Set<BuildState> = new Set([
  'pending_review',
  'pending_review_llm',
  'approved',
  'rejected',
  'published',
  'failed',
]);

function logState(log: Job['log'], id: string, state: BuildState) {
  try {
    if (state === 'failed') log?.error?.({ id, state }, 'build:state');
    else log?.info({ id, state }, 'build:state');
  } catch {}
}

async function emitState(id: string, state: BuildState, progress: number) {
  const job = jobs.get(id);
  if (job) job.emitter.emit('state', { state, progress });
}

async function runJob(job: Job): Promise<void> {
  const { id, controller, log } = job;
  try {
    let rec = (await readBuild(id)) || (await initBuild(id));
    const dir = getBuildDir(id);
    const steps: Array<{
      state: BuildState;
      progress: number;
      fn: () => Promise<void>;
    }> = [
      {
        state: 'analyze',
        progress: 10,
        fn: async () => {
          const entry = path.join(dir, 'app.js');
          try {
            await fs.access(entry);
          } catch {
            throw new Error('missing_entry');
          }
          const code = await fs.readFile(entry, 'utf8');
          const info = await analyzeExports(code);
          const outDir = path.join(dir, 'build');
          await fs.mkdir(outDir, { recursive: true });
          await fs.writeFile(
            path.join(outDir, 'AST_SUMMARY.json'),
            JSON.stringify(info, null, 2),
          );
        },
      },
      {
        state: 'build',
        progress: 40,
        fn: async () => {
          const entry = path.join(dir, 'app.js');
          const jsSource = await fs.readFile(entry, 'utf8');
          const isEmptyEntry = !jsSource.trim();
          const outDir = path.join(dir, 'bundle');
          await fs.mkdir(outDir, { recursive: true });

          if (isEmptyEntry) {
            // Pure HTML submission â€“ copy the prebuilt HTML bundle without running esbuild/React bootstrap
            const buildDir = path.join(dir, 'build');
            await fs.rm(outDir, { recursive: true, force: true });
            await fs.mkdir(outDir, { recursive: true });
            await fs.cp(buildDir, outDir, { recursive: true });
            return;
          }

          // Create a virtual bootstrap with error overlay and dynamic import of the user module
          const virtualEntry = `
            const __overlayId = '__createx_error_overlay';
            function showErrorOverlay(message, detail) {
              try {
                console.error('[createx:play:error]', message, detail || '');
                let el = document.getElementById(__overlayId);
                if (el) { const m = el.querySelector('.__msg'); if (m) m.textContent = String(message||'Error'); return; }
                el = document.createElement('div');
                el.id = __overlayId;
                el.style.position = 'fixed'; el.style.inset = '0'; el.style.background = 'rgba(190,18,60,0.10)'; el.style.zIndex = '2147483647';
                const box = document.createElement('div'); box.style.position='absolute'; box.style.left='50%'; box.style.top='16px'; box.style.transform='translateX(-50%)'; box.style.maxWidth='90%'; box.style.fontFamily='ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial'; box.style.background='#fee2e2'; box.style.color='#991b1b'; box.style.border='1px solid #fecaca'; box.style.borderRadius='12px'; box.style.padding='12px 14px'; box.style.boxShadow='0 4px 20px rgba(0,0,0,0.08)';
                const title = document.createElement('div'); title.style.fontWeight='600'; title.style.marginBottom='4px'; title.textContent='App error';
                const msg = document.createElement('div'); msg.className='__msg'; msg.style.whiteSpace='pre-wrap'; msg.style.fontSize='13px'; msg.textContent=String(message||'Unknown error');
                const tip = document.createElement('div'); tip.style.marginTop='6px'; tip.style.fontSize='12px'; tip.style.color='#7f1d1d';
                const m = String(message||'').toLowerCase();
                tip.textContent = m.includes('usecontext') ? 'Tip: React hooks crash detected. Check for SES/lockdown or duplicate React copies.' : 'Open console for details.';
                box.appendChild(title); box.appendChild(msg); box.appendChild(tip); el.appendChild(box); document.body.appendChild(el);
              } catch {}
            }
            (function attachGlobalHandlers(){
              const once='__createx_err_handlers__'; if ((window)[once]) return; (window)[once]=true;
              window.addEventListener('error', (e)=>{ try{ showErrorOverlay(e?.message||'Script error', e?.error); }catch{} });
              window.addEventListener('unhandledrejection', (e)=>{ const r=e?.reason; const msg=(r&&(r.message||String(r)))||'Unhandled rejection'; try{ showErrorOverlay(msg, r); }catch{} });
            })();
            function ensureRoot(){ let el=document.getElementById('root'); if(!el){ el=document.createElement('div'); el.id='root'; document.body.appendChild(el);} return el; }
            (async () => {
              const root = ensureRoot();
              let mod;
              try { mod = await import(${JSON.stringify(entry)}); } catch (e) { showErrorOverlay((e && (e.message || String(e))) || 'Failed to load app module', e); throw e; }
              try {
                if (typeof (mod as any).mount === 'function') {
                  const res = await (mod as any).mount(root); void res; return;
                }
                if ((mod as any).default) {
                  const React = await import('react');
                  const { createRoot } = await import('react-dom/client');
                  const el = React.createElement((mod as any).default);
                  createRoot(root).render(el);
                  return;
                }
                console.error("App bundle nema default export niti 'mount' funkciju.");
              } catch (e) {
                showErrorOverlay((e && (e.message || String(e))) || 'App render failed', e);
                throw e;
              }
            })().catch((err) => console.error('bootstrap_failed', err));
          `;

          // Resolve root directory for UI stubs (works in dev and in dist)
          let pluginRoot = __dirname;
          try {
            const distCandidate = fssync.existsSync(path.join(__dirname, 'builder', 'virtual-ui.tsx'));
            const srcCandidate = fssync.existsSync(path.join(__dirname, '..', 'src', 'builder', 'virtual-ui.tsx'));
            if (distCandidate) {
              pluginRoot = __dirname;
            } else if (srcCandidate) {
              pluginRoot = path.join(__dirname, '..', 'src');
            }
          } catch {}

          await esbuild.build({
            stdin: {
              contents: virtualEntry,
              sourcefile: 'bootstrap.ts',
              loader: 'ts',
              resolveDir: dir,
            },
            bundle: true,
            platform: 'browser',
            format: 'esm',
            target: 'es2018',
            minify: true,
            outfile: path.join(outDir, 'app.js'),
            logLevel: 'silent',
            plugins: [
              cdnImportPlugin({
                cacheDir: dir,
                rootDir: pluginRoot,
                allow: CDN_ALLOW,
                pin: CDN_PIN,
                external: !!EXTERNAL_HTTP_ESM,
                // Liberal by default; set ALLOW_ANY_NPM=0 to enforce allow-list
                allowAny: !!ALLOW_ANY_NPM,
              }),
            ],
          });

          // Build Tailwind CSS from the generated JS bundle
          try {
            await buildTailwindCSS({
              bundleJsPath: path.join(outDir, 'app.js'),
              outCssPath: path.join(outDir, 'styles.css'),
              safelist: [
                'bg-indigo-500','bg-indigo-600','text-white','text-slate-100',
                'from-indigo-500','to-cyan-400','border-slate-600','border-slate-700',
              ],
              preflight: false,
            });
          } catch (err) {
            // If Tailwind is not available, continue without CSS rather than failing the build
            log?.info?.({ id, err: (err as any)?.message || String(err) }, 'tailwind:skip');
          }

          const html = [
            '<!doctype html>',
            '<html lang="en">',
            '<head>',
            '  <meta charset="utf-8" />',
            '  <meta name="viewport" content="width=device-width,initial-scale=1" />',
            '  <style>html,body{margin:0;padding:0} body{overflow-x:hidden} #root{min-height:100vh}</style>',
            '  <link rel="stylesheet" href="./styles.css" />',
            '</head>',
            '<body>',
            '  <div id="root"></div>',
            '  <script type="module" src="./app.js"></script>',
            '</body>',
            '</html>',
          ].join('\n');
          await fs.writeFile(path.join(outDir, 'index.html'), html, 'utf8');
        },
      },
      {
        state: 'bundle',
        progress: 70,
        fn: async () => {
          const src = path.join(dir, 'bundle');
          const dest = path.join(PREVIEW_ROOT, id);
          await fs.rm(dest, { recursive: true, force: true });
          await fs.mkdir(dest, { recursive: true });
          await fs.cp(src, dest, { recursive: true });
        },
      },
    ];

    const currentIndex = steps.findIndex((s) => s.state === rec.state);
    for (let i = currentIndex + 1; i < steps.length; i++) {
      if (TERMINAL_STATES.has(rec.state)) return;
      if (controller.signal.aborted) throw new Error('cancelled');
      const step = steps[i];
      rec = await updateBuild(id, { state: step.state, progress: step.progress });
      logState(log, id, step.state);
      await emitState(id, rec.state, rec.progress);
      await step.fn();
    }

    if (TERMINAL_STATES.has(rec.state)) return;
    if (controller.signal.aborted) throw new Error('cancelled');

    // verification and safe publish pipeline
    rec = await updateBuild(id, { state: 'verify', progress: 90 });
    logState(log, id, 'verify');
    await emitState(id, rec.state, rec.progress);
    const pipeline = new SafePublishPipeline(undefined, log || console);
    const result = await pipeline.run(id, path.join(dir, 'bundle'));
    rec = await applyPipelineResult(id, result);
    await saveBuildData(id);
    rec = await updateBuild(id, { progress: 100 });
    await emitState(id, rec.state, rec.progress);
  } catch (err: any) {
    const msg =
      err?.message === 'cancelled'
        ? 'cancelled'
        : err?.message ?? String(err);
    await updateBuild(job.id, { state: 'failed', error: msg, progress: 100 });
    logState(log, job.id, 'failed');
    await emitState(job.id, 'failed', 100);
    log?.error?.({ id: job.id, err }, 'build:failed');
  }
}

async function processQueue() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift()!;
    await runJob(job);
    jobs.delete(job.id);
  }
  running = false;
}

export async function createJob(
  id: string,
  log?: { info: (...args: any[]) => void; error?: (...args: any[]) => void },
): Promise<Job> {
  const existing = jobs.get(id);
  if (existing) return existing;
  await initBuild(id);
  const job: Job = { id, controller: new AbortController(), emitter: new EventEmitter(), log };
  jobs.set(id, job);
  queue.push(job);
  processQueue().catch(() => {});
  return job;
}

export function isJobActive(id: string): boolean {
  return jobs.has(id);
}

export function cancelJob(id: string): void {
  const job = jobs.get(id);
  job?.controller.abort();
}

export async function getJob(id: string): Promise<BuildRecord | undefined> {
  return readBuild(id);
}

export function subscribe(
  id: string,
  fn: (evt: { state: BuildState; progress: number }) => void,
) {
  const job = jobs.get(id);
  if (!job) return undefined;
  const handler = (evt: { state: BuildState; progress: number }) => fn(evt);
  job.emitter.on('state', handler);
  return () => job.emitter.off('state', handler);
}

export async function resumePending(log?: Job['log']): Promise<void> {
  let cursor: number | undefined;
  do {
    const { items, nextCursor } = await listBuilds(cursor, 100);
    for (const rec of items) {
      if (!TERMINAL_STATES.has(rec.state)) {
        await createJob(rec.id, log);
      }
    }
    cursor = nextCursor;
  } while (cursor);
}
