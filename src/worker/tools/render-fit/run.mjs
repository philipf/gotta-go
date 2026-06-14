// Runner for the priority_split_v2 render-fit harness (issue #108). Node can't
// execute the harness's .tsx directly (no JSX transform), and the repo doesn't
// carry tsx — so this bundles render.tsx with the esbuild that's already in the
// tree (nested under .pnpm, not hoisted) into a temp .mjs, then imports it.
// Zero new dependencies. Run via `pnpm render:fit` from src/worker.

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readdirSync, rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const workerRoot = resolve(here, '../..'); // src/worker
const require = createRequire(import.meta.url);

// esbuild is a transitive dep (wrangler/vite), so it lives under .pnpm and isn't
// resolvable by name from here — find its package main by directory scan.
const pnpmDir = join(workerRoot, 'node_modules/.pnpm');
const esbuildDir = readdirSync(pnpmDir)
  .filter((d) => d.startsWith('esbuild@'))
  .sort()
  .pop();
if (!esbuildDir) throw new Error('esbuild not found under node_modules/.pnpm — run pnpm install in src/worker');
const esbuild = require(join(pnpmDir, esbuildDir, 'node_modules/esbuild/lib/main.js'));

const bundle = join(here, '.render.bundle.mjs');
await esbuild.build({
  entryPoints: [join(here, 'render.tsx')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  jsx: 'automatic',
  jsxImportSource: 'react',
  outfile: bundle,
  // Resolved from src/worker/node_modules at runtime, not inlined.
  external: ['satori', '@resvg/resvg-wasm', 'react', 'react/jsx-runtime'],
  absWorkingDir: workerRoot,
  logLevel: 'warning',
});

process.env.RENDER_FIT_FONT = join(workerRoot, 'assets/DejaVuSans-Bold.ttf');
process.env.RENDER_FIT_RESVG_WASM = join(workerRoot, 'node_modules/@resvg/resvg-wasm/index_bg.wasm');
process.env.RENDER_FIT_OUT = join(here, 'out');

try {
  await import(pathToFileURL(bundle).href);
} finally {
  rmSync(bundle, { force: true });
}
