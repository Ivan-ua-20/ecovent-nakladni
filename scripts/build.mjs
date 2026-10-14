// Збирає локальну версію в папку dist/: server.mjs (один файл), public/, start.bat
import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/server-node.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/server.mjs',
  external: ['node:*'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
cpSync('public', 'dist/public', { recursive: true });
cpSync('local', 'dist', { recursive: true });
console.log('dist/ готово');
