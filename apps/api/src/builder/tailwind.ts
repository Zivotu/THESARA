import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runNodeCli } from './runBinary.js';

export type TailwindBuildOpts = {
  bundleJsPath: string;      // put do app bundla (app.js)
  outCssPath: string;        // gdje zapisati styles.css
  safelist?: string[];       // dodatne klase koje moramo zadržati
  preflight?: boolean;       // default false — koristimo vlastite resetove
};



export async function buildTailwindCSS(opts: TailwindBuildOpts) {
  const { bundleJsPath, outCssPath, safelist = [], preflight = false } = opts;

  const js = await fs.readFile(bundleJsPath, 'utf8');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-'));
  const inputCss = path.join(tmpDir, 'input.css');
  const configPath = path.join(tmpDir, 'tailwind.config.cjs');

  // Inject minimal design tokens so shadcn-like UI and Tailwind variables render
  // consistently in the review/published sandbox, where global app CSS isn't present.
  const baseVars = `
:root {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --card: 222.2 84% 6%;
  --card-foreground: 210 40% 98%;
  --popover: 222.2 84% 4.9%;
  --popover-foreground: 210 40% 98%;
  --primary: 217.2 91.2% 59.8%;
  --primary-foreground: 222.2 47.4% 11.2%;
  --secondary: 217.2 32.6% 17.5%;
  --secondary-foreground: 210 40% 98%;
  --muted: 217.2 32.6% 17.5%;
  --muted-foreground: 215 20.2% 65.1%;
  --accent: 217.2 32.6% 17.5%;
  --accent-foreground: 210 40% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 210 40% 98%;
  --border: 217.2 32.6% 17.5%;
  --input: 217.2 32.6% 17.5%;
  --ring: 212.7 26.8% 83.9%;
  --radius: 0.5rem;
  color-scheme: dark;
}

/* Light scheme fallback if someone removes body.dark */
@media (prefers-color-scheme: light) {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    color-scheme: light;
  }
}

html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  overflow-x: hidden;
}

#root {
  min-height: 100vh;
}
`;

  const rawCss = `${baseVars}\n@tailwind base;@tailwind components;@tailwind utilities;`;
  await fs.writeFile(inputCss, rawCss, 'utf8');

  const twConfig = {
    darkMode: 'class',
    corePlugins: { preflight },
    safelist,
    content: [{ raw: js, extension: 'tsx' }],
    theme: {},
    plugins: [],
  } as any;
  await fs.writeFile(configPath, `module.exports = ${JSON.stringify(twConfig)};`, 'utf8');

  let cliPath: string;
  try {
    cliPath = require.resolve('tailwindcss/lib/cli.js');
  } catch {
    throw new Error('Tailwind not installed');
  }

  await runNodeCli(cliPath, ['-i', inputCss, '-o', outCssPath, '--minify', '-c', configPath]);

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}
