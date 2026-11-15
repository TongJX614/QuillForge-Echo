import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromEcho = createRequire(resolve(root, 'apps/echo/package.json'));
const esbuild = requireFromEcho('esbuild');

await esbuild.build({
  entryPoints: [resolve(root, 'examples/narrative-demo/src/main.ts')],
  outfile: resolve(root, 'examples/narrative-demo/public/app.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: true,
  logLevel: 'info',
});