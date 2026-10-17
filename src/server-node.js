// Локальний запуск: node server.mjs → http://localhost:8787
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { mkdirSync, existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, normalize, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { openDb } from './core/db-node.js';
import { migrate } from './core/schema.js';
import { createApp } from './app.js';
import { resetOwnerPassword } from './core/auth.js';

process.removeAllListeners('warning');

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || (existsSync(join(here, 'public')) ? join(here, 'data') : join(here, '..', 'data'));
mkdirSync(dataDir, { recursive: true });
const db = openDb(join(dataDir, 'nakladni.db'));
await migrate(db);

// Скидання пароля власника: покладіть у папку data файл RESET-OWNER.txt з новим паролем
// (перший рядок, не менше 6 символів) і перезапустіть програму. Файл буде видалено.
const resetFile = join(dataDir, 'RESET-OWNER.txt');
if (existsSync(resetFile)) {
  const pwd = readFileSync(resetFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)[0].trim();
  if (pwd.length >= 6) {
    const login = await resetOwnerPassword(db, pwd);
    console.log(login ? `\n  Пароль власника «${login}» змінено.` : '\n  Власника ще не створено — скидати нічого.');
  } else {
    console.log('\n  RESET-OWNER.txt: пароль має бути не менше 6 символів. Пароль не змінено.');
  }
  try { unlinkSync(resetFile); } catch { /* не вдалося видалити */ }
}

const root = new Hono();
root.route('/', createApp({ db }));
const publicDir = existsSync(join(here, 'public')) ? join(here, 'public') : join(here, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};
// Ті самі заголовки безпеки, що й на Cloudflare (public/_headers): чужий скрипт на сторінці не виконається.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};
root.get('*', (c) => {
  let rel = decodeURIComponent(new URL(c.req.url).pathname);
  if (rel === '/' || !extname(rel)) rel = '/index.html';
  const file = normalize(join(publicDir, rel));
  if (!file.startsWith(publicDir + sep) || !existsSync(file) || !statSync(file).isFile()) return c.text('Not found', 404);
  return c.body(readFileSync(file), 200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
});

const port = Number(process.env.PORT || 8787);
serve({ fetch: root.fetch, port }, () => {
  const url = `http://localhost:${port}`;
  console.log(`\n  Накладні працюють: ${url}\n  Щоб зупинити — закрийте це вікно.\n`);
  if (process.env.OPEN_BROWSER === '1') {
    const cmd = process.platform === 'win32' ? `start "" ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(cmd);
  }
});
