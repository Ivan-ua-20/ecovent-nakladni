// Правила незалежних блоків (див. README → «Структура»):
//  - модуль імпортує лише core/, integrations/, свої файли і публічний вхід іншого модуля (../<модуль>/index.js);
//  - core/ та integrations/ не залежать від модулів.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : [];
});
const importsOf = (file) => [...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);

const errors = [];
for (const file of files(root)) {
  const rel = relative(root, file);
  for (const spec of importsOf(file)) {
    if (!spec.startsWith('.')) continue; // node:*, hono — зовнішні пакети
    if (rel.startsWith('modules/')) {
      const ok = spec.startsWith('../../core/') || spec.startsWith('../../integrations/') || spec.startsWith('./')
        || /^\.\.\/[a-z-]+\/index\.js$/.test(spec);
      if (!ok) errors.push(`${rel}: імпорт «${spec}» — до іншого модуля лише через його index.js`);
    } else if (rel.startsWith('core/') || rel.startsWith('integrations/')) {
      if (spec.includes('modules/')) errors.push(`${rel}: core/ та integrations/ не мають залежати від модулів («${spec}»)`);
    }
  }
}
assert.deepEqual(errors, [], `\n${errors.join('\n')}`);
console.log('OK — модулі залежать один від одного лише через публічні входи');
