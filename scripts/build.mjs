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

// Cloudflare Pages Functions: один готовий файл (без залежностей під час збірки на Cloudflare).
mkdirSync('functions/api', { recursive: true });
await build({
  entryPoints: ['src/pages-entry.js'],
  bundle: true,
  platform: 'neutral',
  format: 'esm',
  target: 'es2022',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'worker', 'browser'],
  outfile: 'functions/api/[[path]].js',
  banner: { js: '// ЗГЕНЕРОВАНО: npm run build (src/pages-entry.js). Не редагуйте вручну.' },
});
cpSync('local', 'dist', { recursive: true });
console.log('dist/ готово');
