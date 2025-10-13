import path from "node:path";
import fs from "node:fs/promises";
import postcss from "postcss";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";

export async function buildTailwindCSS(opts: {
  outDir: string;
  contentFiles: string[];   // npr. [.../app.js, .../bootstrap.js]
  filename?: string;        // styles.css
}) {
  const { outDir, contentFiles, filename = "styles.css" } = opts;

  // 1) Pročitaj bundlane JS fajlove kao tekst
  const sources = await Promise.all(contentFiles.map((p) => fs.readFile(p, "utf8")));
  const raw = sources.join("\n");

  // 2) Minimalni entry s Tailwind direktivama
  const cssEntry = "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n";

  // 3) Programski Tailwind config (JIT by default u v3)
  const config = {
    content: [{ raw, extension: "js" }], // KLJUČNO: sve klase dolaze iz bundlanog JS‑a
    theme: { extend: {} },
    darkMode: "class",
    corePlugins: { preflight: true },
    safelist: [
      // par korisnih utilitija koji se mogu pojaviti dinamički
      "bg-gradient-to-r",
      "from-indigo-500",
      "to-cyan-400",
      "rounded-2xl",
      "border",
      "text-slate-100",
      "text-slate-300",
      "text-slate-400",
      "bg-slate-900",
      "bg-slate-800/60",
      "border-slate-700",
      "border-slate-700/60",
    ],
  } as any;

  const result = await postcss([tailwind(config), autoprefixer]).process(cssEntry, { from: undefined });

  const reset = `\nhtml,body{margin:0;padding:0;box-sizing:border-box;height:100%;}\n*,*::before,*::after{box-sizing:inherit;}\nbody{overflow-x:hidden;}\n#root{min-height:100vh;}`;

  const outPath = path.join(outDir, filename);
  await fs.writeFile(outPath, result.css + reset, "utf8");
  return outPath;
}

