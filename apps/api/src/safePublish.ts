﻿import { exec as execCb } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Blob } from 'node:buffer';
import {
  R2Uploader,
  LocalUploader,
  FirebaseUploader,
  type Uploader,
} from './uploader.js';
import { getConfig } from './config.js';
import { AppError } from './lib/errors.js';
import { writeArtifact, resolveBuildDir } from './utils/artifacts.js';
import { zipDirectoryToBuffer } from './lib/zip.js';
import { updateBuild } from './models/Build.js';
import { transformHtmlLite } from './lib/csp.js';
import { detectRoomsStorageKeys } from './lib/roomsBridge.js';
import PDFDocument from 'pdfkit';

const exec = promisify(execCb);

export type Issue = {
  code: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
};

export type SafePublishResult =
  | { status: 'approved'; issues: Issue[] }
  | { status: 'pending-review'; reasons: string[]; issues: Issue[] }
  | { status: 'pending-review-llm'; issues: Issue[] }
  | { status: 'rejected'; reasons: string[]; issues: Issue[] };

const ISSUE_MAP: Record<string, { severity: Issue['severity']; message: string }> = {
  eval: { severity: 'high', message: 'Dinamičko izvršavanje koda je zabranjeno.' },
  new_function: { severity: 'high', message: 'Dinamičko izvršavanje koda je zabranjeno.' },
  window_open: { severity: 'medium', message: 'Otvaranje skočnih prozora je onemogućeno.' },
  cookie_write: { severity: 'medium', message: 'Upis kolačića nije dopušten u kavezu.' },
  fetch_restricted_network: {
    severity: 'medium',
    message: 'Mrežni pozivi nisu dopušteni u odabranom režimu (No-Net).',
  },
  session_sdk_usage: {
    severity: 'medium',
    message: 'Session SDK nije dopušten kada je injekcija onemogućena.',
  },
  'reviewed-open-net': {
    severity: 'medium',
    message: 'Aplikacija traži ručni pregled zbog širokog pristupa mreži.',
  },
  LLM_TOKEN_LIMIT: {
    severity: 'medium',
    message: 'Kod prelazi maksimalnu veličinu konteksta za LLM.',
  },
};

function toIssues(codes: string[]): Issue[] {
  return codes.map((code) => ({ code, ...(ISSUE_MAP[code] || { severity: 'medium', message: code }) }));
}

/**
 * Safe publish pipeline: static scan -> smoke test -> optional LLM triage.
 * Each step is a stub so it can be extended without touching call sites.
 */
export class SafePublishPipeline {
  constructor(
    private uploader: Uploader =
      getConfig().STORAGE_DRIVER === 'r2'
        ? new R2Uploader()
        : getConfig().STORAGE_DRIVER === 'firebase'
        ? new FirebaseUploader()
        : new LocalUploader(),
    private log: {
      info: (...args: any[]) => void;
      error: (...args: any[]) => void;
      warn?: (...args: any[]) => void;
    } = console,
  ) {}

  async run(appId: string, dir: string): Promise<SafePublishResult> {
    try {
      const cfg = getConfig();
      try {
        const originalZip = await zipDirectoryToBuffer(dir);
        await writeArtifact(appId, 'bundle_original.zip', originalZip);
      } catch (err: any) {
        this.log.warn?.({ id: appId, err }, 'publish:zip_original_failed');
      }

      if (cfg.PUBLISH_CSP_AUTOFIX !== false) {
        const indexPath = path.join(dir, 'index.html');
        try {
          await fs.promises.access(indexPath);
          const roomsAllowlist = Array.isArray(cfg.THESARA_ROOMS_KEYS)
            ? cfg.THESARA_ROOMS_KEYS
            : [];
          let detectedRoomsKeys: string[] = [];
          if (cfg.PUBLISH_ROOMS_AUTOBRIDGE && roomsAllowlist.length) {
            detectedRoomsKeys = await detectRoomsStorageKeys(dir, roomsAllowlist);
            if (detectedRoomsKeys.length) {
              this.log.info?.(
                { id: appId, roomsKeys: detectedRoomsKeys },
                'publish:rooms_autobridge_detected',
              );
            } else {
              this.log.info?.({ id: appId }, 'publish:rooms_autobridge_skipped_no_keys');
            }
          }

          const report = await transformHtmlLite({
            indexPath,
            rootDir: dir,
            bundleModuleScripts: true,
            vendorExternalResources: true,
            vendorMaxBytes: cfg.PUBLISH_VENDOR_MAX_DOWNLOAD_BYTES,
            vendorTimeoutMs: cfg.PUBLISH_VENDOR_TIMEOUT_MS,
            failOnInlineHandlers: cfg.PUBLISH_CSP_AUTOFIX_STRICT,
            autoBridgeRooms: cfg.PUBLISH_ROOMS_AUTOBRIDGE && detectedRoomsKeys.length > 0,
            roomsStorageKeys: detectedRoomsKeys,
            apiBase: cfg.PUBLIC_BASE,
          });
          this.log.info(
            {
              id: appId,
              inlineScripts: report.inlineScripts.length,
              totalInlineScripts: report.totalInlineScripts,
              inlineStyles: report.inlineStyles.length,
              inlineHandlers: report.inlineEventHandlers.length,
              vendored: report.vendored.length,
              baseRemoved: report.baseRemoved,
            },
            'publish:csp_autofix',
          );
          const reportPayload = {
            generatedAt: new Date().toISOString(),
            inlineScripts: report.inlineScripts,
            totalInlineScripts: report.totalInlineScripts,
            inlineStyles: report.inlineStyles,
            totalInlineStyles: report.totalInlineStyles,
            inlineEventHandlers: report.inlineEventHandlers,
            vendored: report.vendored,
            moduleBundle: report.moduleBundle,
            baseRemoved: report.baseRemoved,
            warnings: report.warnings,
          };
          await fs.promises.writeFile(
            path.join(dir, 'transform_report_v1.json'),
            JSON.stringify(reportPayload, null, 2),
            'utf8',
          );
        } catch (err: any) {
          if (err?.code !== 'ENOENT') {
            this.log.warn?.({ id: appId, err }, 'publish:csp_autofix_failed');
          }
        }
      } else {
        this.log.info?.({ id: appId }, 'publish:csp_autofix_skipped');
      }

      await this.generateArtifacts(appId, dir);
      await this.staticScan(dir);
      await this.vulnerabilityScan(dir);
      await this.smokeTest(dir);
      const manifest = this.readManifest(dir);
      let networkAccess =
        manifest?.networkPolicy
          ? String(manifest.networkPolicy).toLowerCase().replace('_', '-')
          : manifest?.network?.access || manifest?.capabilities?.network?.access;
      if (
        networkAccess === 'open-net' &&
        (!Array.isArray(manifest.networkDomains) || manifest.networkDomains.length === 0)
      ) {
        throw new AppError('NET_OPEN_NEEDS_DOMAINS');
      }
      if (networkAccess === 'reviewed-open-net') {
        try {
          const transformedZip = await zipDirectoryToBuffer(dir);
          await writeArtifact(appId, 'bundle_transformed.zip', transformedZip);
        } catch (err: any) {
          this.log.warn?.({ id: appId, err }, 'publish:zip_transformed_failed');
        }
        this.log.info({ id: appId }, 'upload:start');
        await this.uploader.uploadDir(dir, appId);
        this.log.info({ id: appId }, 'upload:done');
        return {
          status: 'pending-review',
          reasons: ['reviewed-open-net'],
          issues: toIssues(['reviewed-open-net']),
        };
      }
      const { LLM_PROVIDER, OPENAI_API_KEY, LLM_REVIEW_ENABLED } = cfg;
      if (!LLM_REVIEW_ENABLED || LLM_PROVIDER !== 'openai' || !OPENAI_API_KEY) {
        try {
          const transformedZip = await zipDirectoryToBuffer(dir);
          await writeArtifact(appId, 'bundle_transformed.zip', transformedZip);
        } catch (err: any) {
          this.log.warn?.({ id: appId, err }, 'publish:zip_transformed_failed');
        }
        this.log.info({ id: appId }, 'upload:start');
        await this.uploader.uploadDir(dir, appId);
        this.log.info({ id: appId }, 'upload:done');
        return { status: 'pending-review', reasons: [], issues: [] };
      }
      await this.llmTriage(dir, OPENAI_API_KEY);
      try {
        const transformedZip = await zipDirectoryToBuffer(dir);
        await writeArtifact(appId, 'bundle_transformed.zip', transformedZip);
      } catch (err: any) {
        this.log.warn?.({ id: appId, err }, 'publish:zip_transformed_failed');
      }
      this.log.info({ id: appId }, 'upload:start');
      await this.uploader.uploadDir(dir, appId);
      this.log.info({ id: appId }, 'upload:done');
      return { status: 'pending-review-llm', issues: [] };
    } catch (err) {
      this.log.error(err);
      let code = (err as any)?.errorCode || (err as any)?.message || String(err);
      if (typeof code === 'string' && code.startsWith('LLM triage failed')) {
        if (/AbortError/i.test(code)) code = 'LLM_TIMEOUT';
        else {
          const m = /LLM triage failed: (\d{3})/.exec(code);
          const status = m ? Number(m[1]) : 0;
          if (status === 429) code = 'LLM_RATE_LIMIT';
          else if (status === 401) code = 'LLM_UNAUTHORIZED';
          else if (status === 413) code = 'LLM_TOKEN_LIMIT';
          else if (status >= 500) code = 'LLM_SERVER_ERROR';
          else if (status >= 400) code = 'LLM_BAD_REQUEST';
          else code = 'LLM_ERROR';
        }
        return { status: 'pending-review', reasons: [code], issues: toIssues([code]) };
      }
      if (typeof code === 'string' && code.startsWith('pending-review:')) {
        const reasons = code
          .slice('pending-review:'.length)
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean);
        const codes = reasons.length ? reasons : ['manual_review'];
        return {
          status: 'pending-review',
          reasons: codes,
          issues: toIssues(codes),
        };
      }
      if (
        typeof code === 'string' &&
        (code.startsWith('malicious:') || code.startsWith('banned API:'))
      ) {
        const reason = code
          .replace(/^malicious:\s*/i, '')
          .replace(/^banned API:\s*/i, '')
          .trim() || 'rejected';
        return { status: 'rejected', reasons: [reason], issues: toIssues([reason]) };
      }
      return { status: 'pending-review', reasons: [code], issues: toIssues([code]) };
    }
  }

  private async generateArtifacts(buildId: string, dir: string) {
    const cfg = getConfig();
    const files = this.listFiles(dir).map((f) => path.relative(dir, f));
    const astJson = JSON.stringify({ files }, null, 2);
    await fs.promises.writeFile(path.join(dir, 'AST_SUMMARY.json'), astJson);
    await fs.promises.mkdir(path.join(resolveBuildDir(buildId), 'build'), { recursive: true });
    await writeArtifact(buildId, 'build/AST_SUMMARY.json', astJson);
    // Pre-flight import scan (from original user entry if available)
    const buildRoot = path.dirname(dir);
    const entryPath = path.join(buildRoot, 'app.js');
    const importStmtRe = /(?:^|\n)\s*import(?:[^'"`]*?from\s*)?["'`](.*?)["'`]/g;
    const importCallRe = /import\((?:'|")(.*?)(?:'|")\)/g;
    const bareImports = new Set<string>();
    const httpImports = new Set<string>();
    try {
      const code = await fs.promises.readFile(entryPath, 'utf8');
      for (const m of code.matchAll(importStmtRe)) {
        const spec = m[1];
        if (/^https?:\/\//i.test(spec)) httpImports.add(spec);
        else if (!spec.startsWith('.') && !spec.startsWith('/')) bareImports.add(spec);
      }
      for (const m of code.matchAll(importCallRe)) {
        const spec = m[1];
        if (/^https?:\/\//i.test(spec)) httpImports.add(spec);
        else if (!spec.startsWith('.') && !spec.startsWith('/')) bareImports.add(spec);
      }
    } catch {}

    // Persist imports snapshot for admin/LLM visibility
    const importsPayload = {
      entry: 'app.js',
      bare: Array.from(bareImports).sort(),
      http: Array.from(httpImports).sort(),
      files,
      generatedAt: new Date().toISOString(),
    };
    try {
      const importsJson = JSON.stringify(importsPayload, null, 2);
      await fs.promises.writeFile(path.join(dir, 'imports_v1.json'), importsJson);
      await writeArtifact(buildId, 'build/imports_v1.json', importsJson);
    } catch {}

    let manifest = this.readManifest(dir);
    if (!manifest || Object.keys(manifest).length === 0) {
      manifest = { id: buildId, entry: 'app.js', networkPolicy: 'NO_NET' };
    }
    // Augment manifest with discovered imports for reviewer clarity
    try {
      manifest.imports = {
        bare: Array.from(bareImports).sort(),
        http: Array.from(httpImports).sort(),
      };
    } catch {}
    const manifestJson = JSON.stringify(manifest, null, 2);
    await fs.promises.writeFile(path.join(dir, 'manifest_v1.json'), manifestJson);
    await writeArtifact(buildId, 'build/manifest_v1.json', manifestJson);
    try {
      if (manifest?.networkPolicy) {
        await updateBuild(buildId, { networkPolicy: String(manifest.networkPolicy) as any });
      }
    } catch {}
    const plan = { injectSessionSDK: cfg.INJECT_SESSION_SDK };
    const planJson = JSON.stringify(plan, null, 2);
    await fs.promises.writeFile(path.join(dir, 'transform_plan_v1.json'), planJson);
    await writeArtifact(buildId, 'build/transform_plan_v1.json', planJson);

    try {
      const transformReportPath = path.join(dir, 'transform_report_v1.json');
      const transformReport = await fs.promises.readFile(transformReportPath, 'utf8');
      await writeArtifact(buildId, 'build/transform_report_v1.json', transformReport);
    } catch {}
  }

  private async staticScan(dir: string): Promise<void> {
    // Minimal always-on scan: block SES/lockdown regardless of SAFE_PUBLISH_ENABLED
    const filesAll = this.listFiles(dir);
    const alwaysBan = [
      { re: /\blockdown\s*\(/, reason: 'ses_lockdown' },
      { re: /\brequire\s*\(\s*['\"]ses['\"]\s*\)/, reason: 'ses_lockdown' },
      { re: /\bfrom\s+['\"]ses['\"]/, reason: 'ses_lockdown' },
      { re: /import\s*\(\s*['\"]ses['\"]\s*\)/, reason: 'ses_lockdown' },
    ];
    for (const file of filesAll) {
      let code = fs.readFileSync(file, 'utf8');
      if (/\.html?$/i.test(file)) {
        code = this.extractScriptsFromHtml(code);
      } else if (!/\.(js|jsx|ts|tsx)$/i.test(file)) {
        continue;
      }
      for (const p of alwaysBan) {
        if (p.re.test(code)) {
          throw new Error(`banned API: ${p.reason}`);
        }
      }
    }

    if (process.env.SAFE_PUBLISH_ENABLED !== 'true') return;
    const manifest = this.readManifest(dir);
    const networkAccess = manifest?.networkPolicy
      ? String(manifest.networkPolicy).toLowerCase().replace('_', '-')
      : manifest?.network?.access;
    const bannedApis: string[] = manifest?.bannedApis || [];
    const risky: string[] = [];
    const files = filesAll;
    const bannedPatterns = [
      { re: /\beval\s*\(/, reason: 'eval' },
      { re: /\bnew\s+Function\s*\(/, reason: 'new_function' },
      {
        re: /Function\s*\(\s*['\"]return\s+this['\"]\s*\)/,
        reason: 'function_return_this',
      },
      { re: /import\(\s*['\"]https?:\/\//, reason: 'remote_dynamic_import' },
      // SES/lockdown breaks React runtime in the browser – disallow in published apps
      { re: /\blockdown\s*\(/, reason: 'ses_lockdown' },
      { re: /\brequire\s*\(\s*['\"]ses['\"]\s*\)/, reason: 'ses_lockdown' },
      { re: /\bfrom\s+['\"]ses['\"]/, reason: 'ses_lockdown' },
      { re: /import\s*\(\s*['\"]ses['\"]\s*\)/, reason: 'ses_lockdown' },
      // Block known runtime injector filenames and signals
      { re: /lockdown-install\.js/i, reason: 'ses_lockdown' },
      { re: /SES_UNCAUGHT_EXCEPTION/i, reason: 'ses_lockdown' },
    ];
    const riskyPatterns = [
      { re: /setTimeout\s*\(\s*['\"]/ , reason: 'settimeout_string' },
      { re: /document\.cookie\s*=/, reason: 'cookie_write' },
      { re: /window\.open\s*\(/, reason: 'window_open' },
      { re: /(?:new\s+)?Worker\s*\(/, reason: 'worker' },
    ];
    // Flag generic SES Compartment usage for manual review (less certain than lockdown)
    riskyPatterns.push({ re: /\bCompartment\s*\(/, reason: 'ses_compartment' });
    if (!getConfig().INJECT_SESSION_SDK) {
      riskyPatterns.push({ re: /\bstartSession\s*\(/, reason: 'session_sdk_usage' });
    }
    if (bannedApis.includes('localStorage')) {
      riskyPatterns.push({ re: /localStorage\b/, reason: 'localstorage_usage' });
    }
    {
      const netRe = /\b(fetch|XMLHttpRequest|EventSource|WebSocket)\b/;
      riskyPatterns.push({ re: netRe, reason: 'fetch_restricted_network' });
    }
    for (const file of files) {
      let code = fs.readFileSync(file, 'utf8');
      if (/\.html?$/i.test(file)) {
        code = this.extractScriptsFromHtml(code);
      } else if (!/\.(js|jsx|ts|tsx)$/i.test(file)) {
        continue;
      }
      for (const p of bannedPatterns) {
        if (p.re.test(code)) {
          throw new Error(`banned API: ${p.reason}`);
        }
      }
      for (const p of riskyPatterns) {
        if (p.re.test(code)) {
          risky.push(p.reason);
        }
      }
    }
    if (risky.length) {
      throw new Error('pending-review: ' + [...new Set(risky)].join('; '));
    }
  }

  private extractScriptsFromHtml(html: string): string {
    const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let scripts = '';
    let match;
    while ((match = scriptRe.exec(html)) !== null) {
      scripts += match[1] + '\n';
    }
    return scripts;
  }

  private async vulnerabilityScan(dir: string): Promise<void> {
    try {
      await exec('docker info');
    } catch {
      this.log.warn?.('Docker daemon unavailable, skipping npm audit');
      return;
    }
    try {
      await this.runInContainer(
        '[ -f package.json ] && (npm i --package-lock-only --no-audit && npm audit --audit-level=high || true) || true',
        dir,
      );
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        this.log.warn?.('Docker runtime missing, skipping npm audit');
        return;
      }
      throw err;
    }
  }

  private async smokeTest(dir: string): Promise<void> {
    if (process.env.SAFE_PUBLISH_ENABLED !== 'true') return;
    const manifest = this.readManifest(dir);
    const entry = manifest?.entry || 'index.js';

    // HTML apps don't have a JS entry point for the smoke test.
    if (entry.endsWith('.html')) {
      this.log.info({ entry }, 'smokeTest:skip_html');
      return;
    }

    const entryPath = path.join(dir, entry);
    if (!fs.existsSync(entryPath)) return;
    const script = [
      'const path=require("node:path");',
      'const entry=path.resolve(process.argv[1]);',
      'global.window={};',
      'global.document={};',
      'global.localStorage={};',
      'global.fetch=()=>{console.error("blocked:network_call");process.exit(1);};',
      'global.Worker=function(){console.error("blocked:worker");process.exit(1);};',
      'Object.defineProperty(global.window,"top",{get(){console.error("blocked:window_top");process.exit(1);}});',
      'global.window.open=()=>{console.error("blocked:window_open");process.exit(1);};',
      'Object.defineProperty(global.document,"cookie",{set(){console.error("blocked:cookie_write");process.exit(1);},get(){return"";}});',
      manifest?.bannedApis?.includes('localStorage')
        ? 'global.localStorage=new Proxy({},{get(){console.error("blocked:localstorage");process.exit(1);},set(){console.error("blocked:localstorage");process.exit(1);}});'
        : '',
      'try{require(entry);}catch(e){console.error("blocked:"+(e&&e.message?e.message:String(e)));process.exit(1);}']
      .filter(Boolean)
      .join('');
    try {
      await this.runInContainer(
        `node -e "${script.replace(/"/g, '\\"')}" "${entry}"`,
        dir,
        { cpus: 1, memory: '128m', network: 'none' },
      );
    } catch (err) {
      const out = `${(err as any)?.stdout || ''}\n${(err as any)?.stderr || ''}`;
      const match = /blocked:([a-z_]+)/i.exec(out) || [];
      const reason = match[1] || 'runtime_error';
      this.log.info({ reason }, 'smokeTest:block');
      throw new Error('pending-review: ' + reason);
    }
  }

  private async runInContainer(
    cmd: string,
    dir: string,
    opts: { cpus?: number; memory?: string; network?: string } = {},
  ): Promise<void> {
    const limits = [
      opts.cpus ? `--cpus=${opts.cpus}` : '',
      opts.memory ? `--memory=${opts.memory}` : '',
      opts.network ? `--network=${opts.network}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const dockerCmd = `docker run --rm ${limits} -v "${dir}":/workspace -w /workspace node:20 sh -lc "${cmd}"`;
    await exec(dockerCmd);
  }

  private readManifest(dir: string): any {
    for (const name of ['manifest.json', 'manifest_v2.json', 'manifest_v1.json']) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) {
        try {
          return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {}
      }
    }
    return {};
  }

  private listFiles(dir: string): string[] {
    const res: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) res.push(...this.listFiles(full));
      else res.push(full);
    }
    return res;
  }

  private async llmTriage(dir: string, apiKey: string): Promise<void> {
    const base = (process.env.LLM_API_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || '60000');

    async function fetchWithTimeout(url: string, opts: any): Promise<Response> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...opts, signal: controller.signal });
        clearTimeout(timer);
        return res;
      } catch (err) {
        clearTimeout(timer);
        throw err;
      }
    }

    try {
      const files = this.listFiles(dir);
      const doc = new PDFDocument();
      const buffers: Buffer[] = [];
      doc.on('data', (b: Buffer) => buffers.push(b));
      const pdfPromise = new Promise<Buffer>((resolve) =>
        doc.on('end', () => resolve(Buffer.concat(buffers)))
      );
      doc.font('Courier').fontSize(10);
      files.forEach((file, idx) => {
        const rel = path.relative(dir, file);
        const content = fs.readFileSync(file, 'utf8');
        if (idx > 0) doc.addPage();
        doc.text(`File: ${rel}\n\n${content}`);
      });
      doc.end();
      const pdfBuffer = await pdfPromise;

      const form = new FormData();
      form.append('purpose', 'assistants');
      const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
      form.append('file', blob, 'code.pdf');
      const fileRes = await fetchWithTimeout(`${base}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!fileRes.ok) {
        let body = '';
        try {
          body = await fileRes.text();
        } catch {}
        throw new Error(
          `LLM triage failed: ${fileRes.status} ${fileRes.statusText}${
            body ? ` - ${body}` : ''
          }`,
        );
      }
      const fileJson = (await fileRes.json()) as Record<string, any>;
      const file = fileJson.id;
      if (!file) {
        throw new Error('LLM triage failed: missing file id from upload response');
      }
      const res = await fetchWithTimeout(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a security reviewer.' },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Review the attached code for security issues.',
                },
              ],
              attachments: [{ file_id: file }],
            },
          ],
        }),
      });
      if (!res.ok) {
        let body = '';
        try {
          body = await res.text();
        } catch {}
        throw new Error(
          `LLM triage failed: ${res.status} ${res.statusText}${
            body ? ` - ${body}` : ''
          }`,
        );
      }
    } catch (err) {
      throw new Error(`LLM triage failed: ${String(err)}`);
    }
  }
}
