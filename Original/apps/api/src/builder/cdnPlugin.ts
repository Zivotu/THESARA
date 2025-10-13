import path from "node:path";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import {
  brotliDecompressSync,
  gunzipSync,
  inflateSync,
} from "node:zlib";
import * as esbuild from "esbuild";

// === Types ===
export type Opts = {
  cdnBase?: string;               // default: https://esm.sh
  cacheDir: string;               // gdje spremamo CDN fajlove
  allow?: string[];               // dodatni dozvoljeni bare imports
  pin?: Record<string, string>;   // pin verzija (ime -> verzija)
  allowAny?: boolean;             // dopusti sve bare imports (dev)
  rootDir?: string;               // apsolutni root src-a
  external?: boolean;             // ako je true, HTTP moduli ostaju eksterni (ne inlajnamo)
};

// === Helpers ===
const DEFAULT_CDN = "https://esm.sh";
const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

const byExtToLoader: Record<string, esbuild.Loader> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".mts": "ts",
  ".js": "js",
  ".mjs": "js",
  ".jsx": "jsx",
  ".css": "css",
  ".json": "json",
};

function splitPkg(spec: string) {
  if (spec.startsWith("@")) {
    const [scope, rest] = spec.split("/");
    const [name, ...sub] = rest.split("/");
    return { name: `${scope}/${name}`, subpath: sub.join("/") };
  }
  const [name, ...sub] = spec.split("/");
  return { name, subpath: sub.join("/") };
}

async function ensureDir(d: string) {
  await fs.mkdir(d, { recursive: true });
}

function decompress(buf: Buffer, encoding: string | null) {
  switch (encoding) {
    case "br":
      return brotliDecompressSync(buf);
    case "gzip":
      return gunzipSync(buf);
    case "deflate":
      return inflateSync(buf);
    default:
      return buf;
  }
}

async function fetchHttp(url: string, forceIdentity = false) {
  const headers = forceIdentity
    ? { "accept-encoding": "identity" }
    : { "accept-encoding": "br, gzip, deflate" };
  const res = await fetch(url, { redirect: "follow", headers });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  const enc = res.headers.get("content-encoding");
  try {
    buf = decompress(buf, enc);
  } catch {
    if (!forceIdentity) {
      return fetchHttp(url, true);
    }
  }
  return { buffer: buf, contentType: res.headers.get("content-type"), url: res.url };
}

function loaderFromExt(ext: string, contentType?: string | null): esbuild.Loader {
  const byExt = byExtToLoader[ext];
  if (byExt) return byExt;
  if (contentType?.includes("json")) return "json";
  if (contentType?.includes("css")) return "css";
  return "js";
}

async function getFromCacheOrFetch(url: string, cacheDir: string) {
  const dir = path.join(cacheDir, "cdn-cache");
  await ensureDir(dir);
  const key = sha1(url);
  try {
    const files = await fs.readdir(dir);
    const match = files.find((f) => f.startsWith(key));
    if (match) {
      const cached = await fs.readFile(path.join(dir, match));
      const ext = path.extname(match).toLowerCase();
      return {
        source: cached.toString("utf-8"),
        loader: loaderFromExt(ext),
        url,
      };
    }
  } catch {} 

  const { buffer, contentType, url: finalUrl } = await fetchHttp(url);
  const text = buffer.toString("utf-8");

  const snippet = text.slice(0, 200).replace(/\s+/g, " ").trim();
  const ct = contentType || "unknown";
  const typeOk =
    ct.includes("javascript") || ct.includes("json") || ct.includes("css");
  const looksHtml = ct.includes("html") || /<html/i.test(snippet);
  if (!typeOk || looksHtml) {
    throw new Error(
      `Unexpected CDN response ${finalUrl} (content-type: ${ct})\n${snippet}`
    );
  }

  const urlObj = new URL(finalUrl);
  let ext = path.extname(urlObj.pathname).toLowerCase();
  if (!ext) {
    if (contentType?.includes("javascript")) ext = ".js";
    else if (contentType?.includes("css")) ext = ".css";
    else if (contentType?.includes("json")) ext = ".json";
    else ext = ".mjs";
  }

  const filePath = path.join(dir, `${key}${ext}`);
  await fs.writeFile(filePath, text, "utf-8");
  return { source: text, loader: loaderFromExt(ext, contentType), url: finalUrl };
}

function stripHttpUrlNamespace(p: string) {
  return p.replace(/^http-url:/, "");
}

function resolveFromImporter(spec: string, importer: string, origin: string) {
  const base = importer ? stripHttpUrlNamespace(importer) : origin;
  return new URL(spec, base).toString();
}

// === Dedupe helper za esm.sh URL-ove Reacta ===
function normalizeEsmShReact(u: URL, pins: Record<string, string>) {
  // Radimo rewrite svega što cilja na react/react-dom/react/jsx-runtime na pinanu verziju
  const hostOk = u.hostname === "esm.sh" || u.hostname.endsWith(".esm.sh");
  if (!hostOk) return u;

  const pathname = u.pathname; // npr. /react@18.3.1/jsx-runtime
  const reactPin = pins["react"] || "19.2.0";
  const reactDomPin = pins["react-dom"] || "19.2.0";

  // react/jsx-runtime
  if (/^\/react(@[^/]+)?\/jsx-runtime(?:\.m?js)?$/.test(pathname)) {
    u.pathname = `/react@${reactPin}/jsx-runtime`;
    u.search = ""; // canonicalize to avoid duplicate module identities
    return u;
  }
  // react/jsx-dev-runtime
  if (/^\/react(@[^/]+)?\/jsx-dev-runtime(?:\.m?js)?$/.test(pathname)) {
    u.pathname = `/react@${reactPin}/jsx-dev-runtime`;
    u.search = "";
    return u;
  }
  // react-dom/client
  if (/^\/react-dom(@[^/]+)?\/client(?:\.m?js)?$/.test(pathname)) {
    u.pathname = `/react-dom@${reactDomPin}/client`;
    u.search = "";
    return u;
  }
  // točno react ili react-dom (s opcionalnim subpathom)
  if (/^\/react(@[^/]+)?(?:\/.*)?$/.test(pathname)) {
    u.pathname = pathname.replace(/^\/react(@[^/]+)?/, `/react@${reactPin}`);
    u.search = "";
    return u;
  }
  if (/^\/react-dom(@[^/]+)?(?:\/.*)?$/.test(pathname)) {
    u.pathname = pathname.replace(/^\/react-dom(@[^/]+)?/, `/react-dom@${reactDomPin}`);
    u.search = "";
    return u;
  }
  return u;
}

// === Plugin ===
export function cdnImportPlugin(opts: Opts): esbuild.Plugin {
  const cdnBase = (opts.cdnBase || DEFAULT_CDN).replace(/\/+$/, "");
  const EXTERNAL = opts.external === true;

  // Allow-list
  const ALLOW = new Set(
    [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "framer-motion",
      "recharts",
      "html-to-image",
      "three",
      "@radix-ui/react-slider",
      "firebase/app",
      "firebase/auth",
      "firebase/firestore",
      // dodaj po potrebi
      ...(opts.allow || []),
    ].map((s) => s.toLowerCase())
  );

  // Pinovi (default + korisnički)
  const PIN: Record<string, string> = Object.assign(
    {
      react: "19.2.0",
      "react-dom": "19.2.0",
      "framer-motion": "11.0.0",
      recharts: "2.12.7",
      "html-to-image": "1.11.11",
      three: "0.160.0",
      // Keep Firebase stable for CDN resolution of subpaths like firebase/app, firebase/auth
      firebase: "10.12.4",
    },
    opts.pin || {}
  );

  return {
    name: "cdn-import",
    setup(build) {
      const cacheDir = opts.cacheDir;
      const absRoot = opts.rootDir
        ? path.resolve(opts.rootDir)
        : process.cwd();

      // 1) UI aliasi -> zajednički virtual-ui modul
      build.onResolve(
        { filter: /^@\/components\/ui\/(card|button|input|slider|label|textarea)$/ },
        async () => {
          const file = path.join(absRoot, "builder", "virtual-ui.tsx");
          try {
            await fs.access(file);
          } catch {
            throw new Error(
              "virtual-ui.tsx not found; run build scripts or add required UI stubs"
            );
          }
          return { path: file };
        }
      );

      // 2) Alias '@/...' -> lokalni 'src/...'
      build.onResolve({ filter: /^@\// }, (args) => {
        const target = path.join(absRoot, args.path.slice(2));
        return { path: target };
      });

      // 3) Apsolutni HTTP(S) importi
      build.onResolve({ filter: /^https?:\/\// }, (args) => {
        const origin = new URL(args.path).origin;
        if (EXTERNAL) {
          return { path: args.path, external: true } as any;
        }
        return { path: args.path, namespace: "http-url", pluginData: { origin } };
      });

      // 4) Bare imports iz korisničkog koda -> CDN + pin
      build.onResolve({ filter: /^[^./][^:]*$/ }, (args) => {
        if (opts.allowAny !== true) {
          const { name, subpath } = splitPkg(args.path);
          const specExact = (subpath ? `${name}/${subpath}` : name).toLowerCase();
          const baseName = name.toLowerCase();
          if (!ALLOW.has(specExact) && !ALLOW.has(baseName)) {
            return {
              errors: [
                {
                  text:
                    `Paket "${args.path}" nije na allow-listi. Dozvoljeni: ${[
                      ...ALLOW,
                    ]
                      .sort()
                      .join(
                        ", "
                      )}.` +
                    `\n→ Rješenja: (1) ukloni/zamijeni paket, (2) Upload ZIP s node_modules, (3) dodaj u allow-listu.`,
                },
              ],
            } as any;
          }
        }
        const { name, subpath } = splitPkg(args.path);
        const ver = PIN[name] || "latest";
        const url = `${cdnBase}/${name}@${ver}${subpath ? `/${subpath}` : ""}`;
        const origin = new URL(url).origin;
        if (EXTERNAL) {
          return { path: url, external: true } as any;
        }
        return { path: url, namespace: "http-url", pluginData: { origin } };
      });

      // 5) Resolve za http URL-ove (i *normalizacija React* na pin)
      build.onResolve({ filter: /.*/, namespace: "http-url" }, (args) => {
        const importer = stripHttpUrlNamespace(args.importer);
        const origin = (args.pluginData as any)?.origin || new URL(importer).origin;
        const abs = resolveFromImporter(args.path, importer, origin);
        // Ukloni caret da URL parser ne padne
        const sanitized = abs.replace(/@\^/g, "@");
        const normalized = normalizeEsmShReact(new URL(sanitized), PIN);
        if (EXTERNAL) {
          return { path: normalized.toString(), external: true } as any;
        }
        return {
          path: normalized.toString(),
          namespace: "http-url",
          pluginData: { origin },
        };
      });

      // 6) Load za http URL-ove (s cacheom i ispravnim loaderom) — preskoči ako je external
      if (!EXTERNAL) {
        build.onLoad({ filter: /.*/, namespace: "http-url" }, async (args) => {
          const { source, loader } = await getFromCacheOrFetch(args.path, cacheDir);
          const prefix = `//# sourceURL=${args.path}\n`;
          return {
            contents: prefix + source,
            loader,
            resolveDir: new URL("./", args.path).toString(),
          };
        });
      }
    },
  };
}
