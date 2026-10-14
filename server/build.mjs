// Packs the server into ONE file (server-dist/server.mjs) and copies the screens (dist → server-dist/web).
import { build } from 'esbuild';
import fs from 'node:fs';

await build({
  entryPoints: ['server/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'server-dist/server.mjs',
  // Libraries written for "require" need it inside an ES module bundle.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  external: ['node:sqlite'],
  logLevel: 'warning',
});
fs.rmSync('server-dist/web', { recursive: true, force: true });
fs.cpSync('dist', 'server-dist/web', { recursive: true });
console.log('server-dist ready');
