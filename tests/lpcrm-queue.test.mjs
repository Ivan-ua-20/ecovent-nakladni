// Черга до LP-CRM: запит, що завис (обірване звернення на Cloudflare), не зупиняє наступні запити;
// пауза між запитами зберігається; lpcrmBusy бачить тих, хто чекає своєї черги.
import assert from 'node:assert/strict';
import { call, lpcrmBusy } from '../src/integrations/lpcrm.js';

const ok = async () => new Response(JSON.stringify({ status: 'ok', data: [] }));
const never = (url, opts) => new Promise(() => { void opts; }); // ніколи не завершується й не зважає на тайм-аут

// перший запит завис назавжди
call(never, 'x', 'k', 'getStatuses', {}).catch(() => {});
// наступні — проходять, з паузою ~1,5 с між стартами
const t0 = Date.now();
const [a, b] = await Promise.all([call(ok, 'x', 'k', 'getStatuses', {}), call(ok, 'x', 'k', 'getStatuses', {})]);
const ms = Date.now() - t0;
assert.equal(a.status, 'ok');
assert.equal(b.status, 'ok');
assert.ok(ms >= 2900 && ms < 4500, `два запити після завислого — з паузами, без вічного очікування (${ms} мс)`);

// поки хтось чекає черги — LP-CRM зайнята; невдовзі після останнього запиту — теж (5 с), потім вільна
const p = call(ok, 'x', 'k', 'getStatuses', {});
assert.equal(lpcrmBusy(0), true, 'хтось чекає черги');
await p;
assert.equal(lpcrmBusy(0), false);
assert.equal(lpcrmBusy(), true, 'щойно звертались');
console.log(`OK — черга LP-CRM: завислий запит не блокує інших (${ms} мс на два)`);
process.exit(0); // завислий проміс не тримає процес
