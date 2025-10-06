import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import * as esbuild from "esbuild";
import { cdnImportPlugin } from "../src/builder/cdnPlugin.ts";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// stub fetch to avoid network access
(globalThis as any).fetch = async (url: string) => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new TextEncoder().encode("export default {}"),
  headers: new Map([["content-type", "application/javascript"]]),
  url: String(url),
});

async function buildsWithVirtualUi() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "build-test-"));
  const entry = path.join(tmp, "app.tsx");
  const code =
    "import { Card } from '@/components/ui/card'; export default function App(){ return <Card /> }";
  await fs.writeFile(entry, code);

  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: path.join(tmp, "out.js"),
    write: false,
    plugins: [
      cdnImportPlugin({
        cacheDir: tmp,
        rootDir: path.join(__dirname, "../src"),
      }),
    ],
  });

  const output = result.outputFiles?.[0]?.text || "";
  assert(output.includes("rounded-2xl border border-slate-700"));
}

async function throwsWithoutVirtualUi() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "build-test-"));
  const entry = path.join(tmp, "app.tsx");
  const code =
    "import { Card } from '@/components/ui/card'; export default function App(){ return <Card /> }";
  await fs.writeFile(entry, code);

  let threw = false;
  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      platform: "browser",
      outfile: path.join(tmp, "out.js"),
      write: false,
      plugins: [cdnImportPlugin({ cacheDir: tmp, rootDir: tmp })],
    });
  } catch (err: any) {
    threw = true;
    assert(err.message.includes("virtual-ui.tsx not found"));
  }
  assert(threw, "expected build to throw when virtual-ui.tsx missing");
}

(async () => {
  await buildsWithVirtualUi();
  await throwsWithoutVirtualUi();
  console.log("virtual-ui resolve test passed");
})();

