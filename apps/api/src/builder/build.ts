import path from "node:path";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";
import { playHtmlTemplate } from "../play/template.js";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { cdnImportPlugin, type Opts as CdnOpts } from "./cdnPlugin.js";
import fs from "node:fs";
import { buildTailwindCSS } from "./tailwind.js";

const NAME_SHIM = 'var __name = globalThis.__name || (globalThis.__name = (fn,name)=>{try{Object.defineProperty(fn,"name",{value:name,configurable:true});}catch{}return fn;});';
const NAME_SHIM_FILE = "__name-shim.js";

// === Types ===
export type Opts = CdnOpts;

const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");
const ensureDir = async (dir: string) => fs.mkdir(dir, { recursive: true });
const DIRNAME = __dirname;

function makeVirtualEntry(userEntryUrl: string): string {
  return `import * as __mod from ${JSON.stringify(userEntryUrl)};
export * from ${JSON.stringify(userEntryUrl)};
export { default } from ${JSON.stringify(userEntryUrl)};
export async function mount(node: HTMLElement) {
  const m: any = __mod;
  if (typeof m.mount === 'function') {
    const res = await m.mount(node);
    return typeof res === 'function' ? res : (() => {});
  }
  if (m.default) {
    try {
      const React = await import('react');
      const ReactDOM = await import('react-dom/client');
      const root = ReactDOM.createRoot(node);
      root.render(React.createElement(m.default));
      return () => root.unmount();
    } catch {}
  }
  return () => {};
}`;
}

function userAppPlugin(): esbuild.Plugin {
  return {
    name: "user-app",
    setup(build) {
      build.onResolve({ filter: /^virtual:user-app$/ }, () => ({ path: "virtual:user-app", namespace: "virtual" }));

      build.onLoad({ filter: /^virtual:user-app$/, namespace: "virtual" }, () => {
        const raw =
          (build.initialOptions.define?.__USER_CODE__ as unknown as string) ??
          "\"export default function App(){ return null }\"";
        const userCode = JSON.parse(raw) as string;
        return { contents: userCode, loader: "tsx" };
      });
    },
  };
}

// === Build izlazi ===
type BuildResult =
  | {
      ok: true;
      id: string;
      dir: string;
      indexPath: string;
    }
  | {
      ok: false;
      error: string;
    };

const buildsDir = (root: string) => path.join(root, "builds");

function injectNameShim(html: string) {
  if (html.includes(`${NAME_SHIM_FILE}`)) {
    return html;
  }
  const tag = `<script src=\"./${NAME_SHIM_FILE}\"></script>`;
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>\n  ${tag}`);
  }
  if (html.includes("<body")) {
    return html.replace(/<body([^>]*)>/, `<body$1>\n  ${tag}`);
  }
  return `${tag}\n${html}`;
}

async function writeNameShim(outDir: string) {
  await fs.writeFile(path.join(outDir, NAME_SHIM_FILE), NAME_SHIM, "utf8");
}

export async function analyzeExports(code: string) {
  let transformed = code;
  try {
    const res = await esbuild.transform(code, {
      loader: "tsx",
      format: "esm",
      jsx: "automatic",
      jsxDev: process.env.NODE_ENV !== 'production',
    });
    transformed = res.code;
  } catch {}

  try {
    let init: any, parse: any;
    try {
      ({ init, parse } = await import("es-module-lexer"));
    } catch {
      const esbuildPkg = require.resolve("esbuild/package.json");
      const pnpmFolder = path.resolve(path.dirname(esbuildPkg), "../../..");
      const pnpmNodeModules = path.join(pnpmFolder, "node_modules");
      const lexer = path.join(pnpmNodeModules, "es-module-lexer", "dist", "lexer.js");
      ({ init, parse } = await import(pathToFileURL(lexer).href));
    }
    await init;
    const [, exps] = parse(transformed);
    const names = Array.isArray(exps)
      ? exps.map((e: any) => (typeof e === "string" ? e : e.n))
      : [];
    return {
      hasDefault: names.includes("default"),
      hasMount: names.includes("mount"),
    };
  } catch {
    return { hasDefault: false, hasMount: false };
  }
}

function exportsFromMetafile(meta: esbuild.Metafile) {
  const outputs = Object.values(meta.outputs || {});
  const exps = outputs[0]?.exports || [];
  return {
    hasDefault: exps.includes("default"),
    hasMount: exps.includes("mount"),
  };
}

function findSingleComponent(code: string): string | null {
  try {
    const ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
    const names: string[] = [];
    const returnsJSX = (body: t.BlockStatement | t.Expression | undefined) => {
      if (!body) return false;
      if (t.isJSXElement(body) || t.isJSXFragment(body)) return true;
      if (t.isBlockStatement(body)) {
        for (const stmt of body.body) {
          if (
            t.isReturnStatement(stmt) &&
            stmt.argument &&
            (t.isJSXElement(stmt.argument) || t.isJSXFragment(stmt.argument))
          ) {
            return true;
          }
        }
      }
      return false;
    };
    traverse(ast, {
      FunctionDeclaration(path) {
        const id = path.node.id;
        if (id && /^[A-Z]/.test(id.name) && returnsJSX(path.node.body)) {
          names.push(id.name);
        }
      },
      VariableDeclarator(path) {
        if (t.isIdentifier(path.node.id) && /^[A-Z]/.test(path.node.id.name)) {
          const init = path.node.init;
          if (
            init &&
            (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) &&
            returnsJSX(init.body as any)
          ) {
            names.push(path.node.id.name);
          }
        }
      },
    });
    return names.length === 1 ? names[0] : null;
  } catch {
    return null;
  }
}

// === Public API ===
export async function buildFromHtml(html: string, opts: Opts & { id?: string; title?: string }): Promise<BuildResult> {
  try {
    const id = (opts.id && opts.id.trim()) || sha1(html + Date.now().toString());
    const outRoot = buildsDir(opts.cacheDir);
    const outDir = path.join(outRoot, id);
    await ensureDir(outDir);
    const indexPath = path.join(outDir, "index.html");
    await fs.writeFile(indexPath, injectNameShim(html), "utf8");
    await writeNameShim(outDir);

    return { ok: true, id, dir: outDir, indexPath };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export async function buildFromReact(
  code: string,
  opts: Opts & { id?: string; title?: string; devFallback?: boolean }
): Promise<BuildResult> {
  try {
    console.log("build:start");
    const title = opts.title || "Thesara App";
    const id = (opts.id && opts.id.trim()) || sha1(code + Date.now().toString());
    const outRoot = buildsDir(opts.cacheDir);
    const outDir = path.join(outRoot, id);
    await ensureDir(outDir);

    let userCode = code;
    let userExports = await analyzeExports(userCode);
    if (!userExports.hasDefault && !userExports.hasMount && opts.devFallback) {
      const comp = findSingleComponent(userCode);
      if (comp) {
        userCode = `${userCode}\nexport default ${comp};`;
        userExports = await analyzeExports(userCode);
      }
    }

    const virtualEntry = makeVirtualEntry("virtual:user-app");
    // Resolve robust root for virtual-ui.tsx in dev and dist
    let pluginRoot = DIRNAME; // default to runtime dir (dist)
    try {
      const distStub = path.join(DIRNAME, "builder", "virtual-ui.tsx");
      const srcStub = path.join(DIRNAME, "..", "src", "builder", "virtual-ui.tsx");
      if (fs.existsSync(distStub)) {
        pluginRoot = DIRNAME;
      } else if (fs.existsSync(srcStub)) {
        pluginRoot = path.join(DIRNAME, "..", "src");
      }
    } catch {}

    const result = await esbuild.build({
      bundle: true,
      format: "esm",
      write: false,
      stdin: { contents: virtualEntry, loader: "ts" },
      plugins: [
        cdnImportPlugin({ ...opts, rootDir: pluginRoot, allowAny: true }),
        userAppPlugin(),
      ],
      define: { __USER_CODE__: JSON.stringify(userCode) },
      metafile: true,
      target: ["es2018"],
      platform: "browser",
      jsx: "automatic",
      jsxDev: true,
      minify: false,
      loader: { ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx" },
      banner: { js: NAME_SHIM },
      logOverride: {
        // react-smooth emits code like `[x] !== y`; esbuild warns but it's 3P code
        "equals-new-object": "silent",
      },
    });

    const outJs = result.outputFiles?.[0]?.text ?? "";
    const unresolved: string[] = [];
    const importStmtRe = /(?:^|\n)\s*import(?:[^'"`]*?from\s*)?["'`](.*?)["'`]/g;
    const importCallRe = /import\((?:'|")(.*?)(?:'|")\)/g;
    for (const m of outJs.matchAll(importStmtRe)) {
      const spec = m[1];
      if (!spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("http://") && !spec.startsWith("https://")) {
        unresolved.push(spec);
      }
    }
    for (const m of outJs.matchAll(importCallRe)) {
      const spec = m[1];
      if (!spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("http://") && !spec.startsWith("https://")) {
        unresolved.push(spec);
      }
    }
    if (unresolved.length) {
      throw new Error(`Unresolved imports: ${unresolved.join(", ")}`);
    }
    const { hasDefault, hasMount } = exportsFromMetafile(result.metafile!);
    console.log(`build:verify export=${hasDefault ? "default" : hasMount ? "mount" : "missing"}`);
    if (!hasDefault && !hasMount) {
      const err =
        "App bundle nema ESM default export niti 'mount' funkciju. Provjeri da app izvor ima 'export default function App() {...}' ili 'export function mount(...) {...}' i da je esbuild format 'esm'.";
      console.log(`build:fail ${err}`);
      return {
        ok: false,
        error: err,
      };
    }

    const appJsPath = path.join(outDir, "app.js");
    await fs.writeFile(appJsPath, outJs, "utf8");

    const bootstrapEntry = `
      // ESM bootstrap, bez inline koda u HTML-u
      // Uključuje lagani overlay za prikaz fatalnih grešaka (npr. React hook/SES problemi)
      const __BUILD_ID__ = ${JSON.stringify(id)};
      const __overlayId = '__createx_error_overlay';

      function showErrorOverlay(message, detail) {
        try {
          // log za dijagnostiku
          console.error('[createx:play:error]', message, detail || '');
          let el = document.getElementById(__overlayId);
          if (el) { el.querySelector('.__msg').textContent = String(message || 'Error'); return; }
          el = document.createElement('div');
          el.id = __overlayId;
          el.style.position = 'fixed';
          el.style.inset = '0';
          el.style.background = 'rgba(190, 18, 60, 0.10)'; // rose-700 /10
          el.style.backdropFilter = 'blur(1px)';
          el.style.zIndex = '2147483647';
          el.style.pointerEvents = 'auto';

          const box = document.createElement('div');
          box.style.position = 'absolute';
          box.style.left = '50%';
          box.style.top = '16px';
          box.style.transform = 'translateX(-50%)';
          box.style.maxWidth = '90%';
          box.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
          box.style.background = '#fee2e2'; // red-100
          box.style.color = '#991b1b'; // red-800
          box.style.border = '1px solid #fecaca'; // red-200
          box.style.borderRadius = '12px';
          box.style.padding = '12px 14px';
          box.style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)';

          const title = document.createElement('div');
          title.style.fontWeight = '600';
          title.style.marginBottom = '4px';
          title.textContent = 'App error';

          const msg = document.createElement('div');
          msg.className = '__msg';
          msg.style.whiteSpace = 'pre-wrap';
          msg.style.fontSize = '13px';
          msg.textContent = String(message || 'Unknown error');

          const tip = document.createElement('div');
          tip.style.marginTop = '6px';
          tip.style.fontSize = '12px';
          tip.style.color = '#7f1d1d'; // red-900
          const m = String(message || '').toLowerCase();
          if (m.includes('usecontext') || m.includes('reactcurrentdispatcher')) {
            tip.textContent = 'Tip: React hooks crash detected. Check for SES/lockdown or duplicate React copies.';
          } else {
            tip.textContent = 'Open console for details. Build: ' + __BUILD_ID__;
          }

          const close = document.createElement('button');
          close.textContent = 'Dismiss';
          close.style.marginLeft = '12px';
          close.style.fontSize = '12px';
          close.style.padding = '2px 8px';
          close.style.border = '1px solid #fecaca';
          close.style.borderRadius = '8px';
          close.style.background = '#fff5f5';
          close.onclick = () => el.remove();

          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.appendChild(tip);
          row.appendChild(close);

          box.appendChild(title);
          box.appendChild(msg);
          box.appendChild(row);
          el.appendChild(box);
          document.body.appendChild(el);
        } catch {}
      }

      (function attachGlobalHandlers(){
        const once = '__createx_err_handlers__';
        if ((window)[once]) return; (window)[once] = true;
        window.addEventListener('error', (e) => {
          try { showErrorOverlay(e?.message || 'Script error', e?.error); } catch {}
        });
        window.addEventListener('unhandledrejection', (e) => {
          const r = e?.reason; const msg = (r && (r.message || String(r))) || 'Unhandled rejection';
          try { showErrorOverlay(msg, r); } catch {}
        });
      })();

      function ensureRoot() {
        let el = document.getElementById('root');
        if (!el) {
          el = document.createElement('div');
          el.id = 'root';
          document.body.appendChild(el);
        }
        return el;
      }

      const root = ensureRoot();

      // Učitajmo korisnički modul tek nakon što postavimo globalne handlere,
      // kako bismo uhvatili greške koje nastaju tijekom evaluacije app.js
      let mod;
      try {
        mod = await import('./app.js');
      } catch (e) {
        showErrorOverlay((e && (e.message || String(e))) || 'Failed to load app module', e);
        throw e;
      }

      try {
        if (typeof mod.mount === 'function') {
          await mod.mount(root);
        } else if (mod.default) {
          // Pretpostavka: app.js je bundlan s React/ReactDOM (preko cdn-import plugina),
          // pa je dovoljno uvesti ih ovdje da dobijemo createElement/createRoot iz bundle-a.
          const React = await import('react');
          const { createRoot } = await import('react-dom/client');
          const el = React.createElement(mod.default);
          createRoot(root).render(el);
        } else {
          console.error("App bundle nema default export niti 'mount' funkciju.");
        }
      } catch (e) {
        showErrorOverlay((e && (e.message || String(e))) || 'App render failed', e);
        throw e;
      }
    `;
    const bootstrapOut = path.join(outDir, 'bootstrap.js');
    const bootstrapRes = await esbuild.build({
      stdin: {
        contents: bootstrapEntry,
        sourcefile: 'bootstrap.ts',
        loader: 'ts',
        resolveDir: outDir,
      },
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      plugins: [
        cdnImportPlugin({ ...opts, rootDir: path.join(DIRNAME, ".."), allowAny: true }),
      ],
      sourcemap: true,
      target: 'es2022',
      logOverride: {
        'equals-new-object': 'silent',
      },
    });
    await fs.writeFile(bootstrapOut, bootstrapRes.outputFiles[0].text, 'utf8');

    await buildTailwindCSS({
      bundleJsPath: path.join(outDir, 'app.js'),
      outCssPath: path.join(outDir, 'styles.css'),
      safelist: [
        'bg-indigo-500','bg-indigo-600','text-white','text-slate-100',
        'from-indigo-500','to-cyan-400','border-slate-600','border-slate-700',
      ],
      preflight: false,
    });

    const indexPath = path.join(outDir, "index.html");
    const html = playHtmlTemplate(title, id);
    await fs.writeFile(indexPath, injectNameShim(html), "utf8");
    await writeNameShim(outDir);

    console.log("build:done");
    return { ok: true, id, dir: outDir, indexPath };
  } catch (e: any) {
    const err = e?.errors?.[0];
    const errMsg = err?.text || e?.message || String(e);
    const loc = err?.location;
    const locMsg = loc ? ` (${loc.file}:${loc.line}:${loc.column})` : "";
    const fullMsg = `${errMsg}${locMsg}`;
    console.log(`build:fail ${fullMsg}`);
    return { ok: false, error: fullMsg };
  }
}
