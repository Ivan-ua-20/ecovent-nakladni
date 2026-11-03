// Зміни налаштувань аналітики через ШІ: ШІ лише ПРОПОНУЄ (список змін «було → стане»), застосовує людина кнопкою.
// Журнал: хто попросив і що написав, що запропоновано, хто застосував / скасував / відкотив і коли.
// Застосування — тими самими маршрутами, що й ручне налаштування (/api/an/structure, /managers, /office-map, /brands,
// /products, /targets, /settings, /ignore): ті самі перевірки й перерахунок. Перед застосуванням — знімок налаштувань;
// відкат відновлює його дослівно (з тими самими id) — лише для останньої застосованої зміни.
import { fail, nowIso, kyivDay } from '../../core/common.js';
import { can } from '../../core/auth.js';
import { logAudit } from '../../core/requisites.js';

const low = (v) => String(v ?? '').trim().toLowerCase();
const uah = (n) => `${Number(n || 0).toLocaleString('uk-UA', { maximumFractionDigits: 2 })} ₴`;
const SETTINGS_NAMES = {
  deptPriority: { name: 'відділ замовлення визначає', values: { manager: 'менеджер', office: 'відділ CRM (офіс)' } },
  targetBase: { name: 'таргет рахується від', values: { net: 'обороту без відмов', all: 'суми всіх замовлень' } },
  compare: { name: 'порівняння з минулим періодом', values: { true: 'увімкнено', false: 'вимкнено' } },
  months: { name: 'завантажувати замовлень за (міс.)' },
};

export const CHANGE_TOOLS = [
  {
    name: 'get_settings',
    description: 'Поточні налаштування аналітики: відділи з джерелами і значеннями «Поле 1», менеджери з відділами, відповідність офісів (відділів CRM) '
      + 'відділам, бренди з ключовими словами, загальні налаштування, таргети поточного місяця, а також що ще не розподілено '
      + '(значення «Поле 1» без джерела, нові менеджери, офіси без відділу — з кількістю замовлень) і скільки товарів без бренду/категорії.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_products',
    description: 'Товари аналітики для ручного бренду/категорії: filter = "nobrand" (без бренду), "nocat" (без категорії) або q — пошук за назвою.',
    input_schema: { type: 'object', properties: { filter: { type: 'string', enum: ['nobrand', 'nocat'] }, q: { type: 'string' } } },
  },
  {
    name: 'propose_changes',
    description: 'Запропонувати зміни налаштувань аналітики. НІЧОГО НЕ ЗМІНЮЄ: користувач побачить список «було → стане» і сам натисне «Застосувати». '
      + 'Перед пропозицією подивись get_settings. Посилання на відділ, джерело чи бренд — id (число) або точна назва (рядок), зокрема щойно доданого в цих же змінах. '
      + 'Типи змін (поле type): '
      + 'dept_add {name}; dept_rename {dept, name}; dept_delete {dept}; '
      + 'source_add {dept, name}; source_rename {source, name}; source_move {source, dept}; source_delete {source}; '
      + 'values_map {source, values[]} — значення «Поле 1» віднести до джерела (з інших джерел вони прибираються); values_unmap {values[]}; '
      + 'manager_set {login, name?, dept, depts?} — dept: основний відділ або null, depts: додаткові відділи; manager_delete {login}; '
      + 'office_set {office, dept} — відділ CRM (id офісу) → відділ або null; '
      + 'brand_set {brand?, name, keywords} — змінити бренд (brand = id/назва) або створити новий; keywords — слова через кому; brand_delete {brand}; '
      + 'product_set {id, brand?, cat?} — ручний бренд/категорія товару (null — прибрати ручне); '
      + 'target_set {month: "YYYY-MM", kind: "dept"|"src", ref, amount} — таргет у гривнях, 0 — прибрати; '
      + 'settings_set {deptPriority?: "manager"|"office", targetBase?: "net"|"all", compare?: bool, months?: 1–18}; '
      + 'ignore_set {kind: "values"|"users"|"offices", value, on: bool} — сховати з «Потребує уваги».',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Коротко, що і навіщо змінюємо (1–2 речення)' },
        ops: { type: 'array', items: { type: 'object' }, description: 'Список змін (див. опис інструмента)' },
      },
      required: ['summary', 'ops'],
    },
  },
];

export function mountAiChanges(app, { db, inner, remap, rebrand, bump, getSt }) {
  const who = (u) => String(u?.name || u?.login || '').slice(0, 80);
  const allowed = (c) => can(c.get('user'), 'analytics');

  // ---------- стан налаштувань ----------
  async function state(c) {
    const cfg = await inner(c, 'GET', '/api/an/config');
    return {
      cfg,
      depts: cfg.depts.map((d) => ({ id: d.id, name: d.name, sources: d.sources.map((s) => ({ id: s.id, name: s.name, values: [...s.values] })) })),
      managers: cfg.managers.map((m) => ({ login: m.login, name: m.name || '', dept: m.dept_id || null, depts: String(m.depts || '').split(',').map(Number).filter(Boolean) })),
      offices: cfg.officeMap.map((o) => ({ office: String(o.office), dept: o.dept_id || null })),
      brands: cfg.brands.map((b) => ({ id: b.id, name: b.name, keywords: b.keywords || '' })),
    };
  }

  // Пропозицію (ops) → новий стан і рядки «було → стане». Невірне посилання — помилка з поясненням (для ШІ).
  async function plan(c, ops) {
    if (!Array.isArray(ops) || !ops.length) throw new Error('Немає змін.');
    if (ops.length > 300) throw new Error('Забагато змін за раз (до 300).');
    const s = await state(c);
    const lines = [];
    const touched = new Set();
    const findDept = (ref) => {
      if (ref == null || ref === '') return null;
      const d = typeof ref === 'number' || /^\d+$/.test(String(ref)) ? s.depts.find((x) => x.id === Number(ref)) : s.depts.find((x) => low(x.name) === low(ref));
      if (!d) throw new Error(`Відділ «${ref}» не знайдено.`);
      return d;
    };
    const allSources = () => s.depts.flatMap((d) => d.sources.map((x) => ({ ...x, dept: d, ref: x })));
    const findSource = (ref) => {
      const list = allSources();
      const m = typeof ref === 'number' || /^\d+$/.test(String(ref)) ? list.filter((x) => x.id === Number(ref)) : list.filter((x) => low(x.name) === low(ref));
      if (!m.length) throw new Error(`Джерело «${ref}» не знайдено.`);
      if (m.length > 1) throw new Error(`Джерел «${ref}» кілька — вкажіть id.`);
      return { src: m[0].ref, dept: m[0].dept };
    };
    const findBrand = (ref) => {
      const b = typeof ref === 'number' || /^\d+$/.test(String(ref)) ? s.brands.find((x) => x.id === Number(ref)) : s.brands.find((x) => low(x.name) === low(ref));
      if (!b) throw new Error(`Бренд «${ref}» не знайдено.`);
      return b;
    };
    const deptName = (d) => (d ? d.name : '— без відділу —');
    const nameStr = (v, max = 80) => {
      const t = String(v ?? '').trim();
      if (!t) throw new Error('Порожня назва.');
      return t.slice(0, max);
    };
    const products = new Map(); // id → { brand?, cat? } (null — прибрати ручне)
    const targets = new Map(); // month → [{ kind, ref, amount }]
    const settings = {};
    const ignores = [];

    for (const op of ops) {
      const t = op?.type;
      switch (t) {
        case 'dept_add': {
          const name = nameStr(op.name);
          if (s.depts.some((d) => low(d.name) === low(name))) throw new Error(`Відділ «${name}» уже є.`);
          s.depts.push({ id: null, name, sources: [] });
          lines.push(`➕ Новий відділ «${name}»`); touched.add('structure');
          break;
        }
        case 'dept_rename': {
          const d = findDept(op.dept); const name = nameStr(op.name);
          lines.push(`✏️ Відділ «${d.name}» → «${name}»`); d.name = name; touched.add('structure');
          break;
        }
        case 'dept_delete': {
          const d = findDept(op.dept);
          s.depts = s.depts.filter((x) => x !== d);
          lines.push(`🗑 Видалити відділ «${d.name}»${d.sources.length ? ` разом із джерелами: ${d.sources.map((x) => `«${x.name}»`).join(', ')}` : ''} (його таргети теж зникнуть)`);
          touched.add('structure');
          break;
        }
        case 'source_add': {
          const d = findDept(op.dept); const name = nameStr(op.name);
          if (d.sources.some((x) => low(x.name) === low(name))) throw new Error(`Джерело «${name}» у відділі «${d.name}» уже є.`);
          d.sources.push({ id: null, name, values: [] });
          lines.push(`➕ Нове джерело «${name}» у відділі «${d.name}»`); touched.add('structure');
          break;
        }
        case 'source_rename': {
          const { src } = findSource(op.source); const name = nameStr(op.name);
          lines.push(`✏️ Джерело «${src.name}» → «${name}»`); src.name = name; touched.add('structure');
          break;
        }
        case 'source_move': {
          const { src, dept } = findSource(op.source); const to = findDept(op.dept);
          if (to === dept) break;
          dept.sources = dept.sources.filter((x) => x !== src); to.sources.push(src);
          lines.push(`↪️ Джерело «${src.name}»: відділ «${dept.name}» → «${to.name}»`); touched.add('structure');
          break;
        }
        case 'source_delete': {
          const { src, dept } = findSource(op.source);
          dept.sources = dept.sources.filter((x) => x !== src);
          lines.push(`🗑 Видалити джерело «${src.name}» (відділ «${dept.name}»)${src.values.length ? `; значення без джерела: ${src.values.slice(0, 10).join(', ')}${src.values.length > 10 ? '…' : ''}` : ''}`);
          touched.add('structure');
          break;
        }
        case 'values_map': {
          const { src } = findSource(op.source);
          const vals = [...new Set((Array.isArray(op.values) ? op.values : []).map(low).filter(Boolean))];
          if (!vals.length) throw new Error('values_map: немає значень.');
          for (const v of vals) {
            const from = allSources().find((x) => x.ref.values.includes(v));
            if (from?.ref === src) continue;
            if (from) from.ref.values = from.ref.values.filter((x) => x !== v);
            src.values.push(v);
            lines.push(`🔗 «Поле 1» «${v}»: ${from ? `джерело «${from.ref.name}»` : 'без джерела'} → «${src.name}»`);
          }
          touched.add('structure');
          break;
        }
        case 'values_unmap': {
          for (const v of (Array.isArray(op.values) ? op.values : []).map(low).filter(Boolean)) {
            const from = allSources().find((x) => x.ref.values.includes(v));
            if (!from) continue;
            from.ref.values = from.ref.values.filter((x) => x !== v);
            lines.push(`⛓️‍💥 «Поле 1» «${v}»: джерело «${from.ref.name}» → без джерела`);
          }
          touched.add('structure');
          break;
        }
        case 'manager_set': {
          const login = low(op.login);
          if (!login) throw new Error('manager_set: немає логіна.');
          const d = op.dept === undefined ? undefined : findDept(op.dept);
          const extra = Array.isArray(op.depts) ? op.depts.map(findDept) : undefined;
          let m = s.managers.find((x) => x.login === login);
          const was = m ? deptName(m.deptRef !== undefined ? m.deptRef : s.depts.find((x) => x.id && x.id === m.dept) || null) : null;
          if (!m) { m = { login, name: '', dept: null, depts: [] }; s.managers.push(m); }
          if (op.name !== undefined) m.name = String(op.name || '').trim().slice(0, 80);
          if (d !== undefined) { m.deptRef = d; m.dept = d?.id || null; }
          if (extra !== undefined) m.extraRefs = extra;
          lines.push(`👤 Менеджер ${login}${m.name ? ` (${m.name})` : ''}: ${was === null ? 'новий' : `відділ «${was}»`} → ${d !== undefined ? `«${deptName(d)}»` : 'відділ без змін'}${extra?.length ? `, додатково: ${extra.map((x) => `«${x.name}»`).join(', ')}` : ''}`);
          touched.add('managers');
          break;
        }
        case 'manager_delete': {
          const login = low(op.login);
          if (!s.managers.some((x) => x.login === login)) throw new Error(`Менеджера ${login} немає в налаштуваннях.`);
          s.managers = s.managers.filter((x) => x.login !== login);
          lines.push(`🗑 Прибрати менеджера ${login} з налаштувань`); touched.add('managers');
          break;
        }
        case 'office_set': {
          const office = String(op.office ?? '').trim();
          if (!office) throw new Error('office_set: немає офісу.');
          const d = findDept(op.dept);
          const cur = s.offices.find((x) => x.office === office);
          const was = cur ? deptName(cur.deptRef || s.depts.find((x) => x.id && x.id === cur.dept) || null) : '— не привʼязано —';
          const oname = s.cfg.offices.find((x) => String(x.office_id) === office)?.name;
          s.offices = s.offices.filter((x) => x.office !== office);
          if (d) s.offices.push({ office, dept: d.id || null, deptRef: d });
          lines.push(`🏢 Відділ CRM ${office}${oname ? ` («${oname}»)` : ''}: «${was}» → «${deptName(d)}»`); touched.add('offices');
          break;
        }
        case 'brand_set': {
          const name = nameStr(op.name);
          const kws = String(op.keywords || name).split(',').map(low).filter(Boolean).join(', ');
          if (op.brand != null && op.brand !== '') {
            const b = findBrand(op.brand);
            lines.push(`🏷 Бренд «${b.name}»${b.name !== name ? ` → «${name}»` : ''}: слова «${b.keywords}» → «${kws}»`);
            b.name = name; b.keywords = kws;
          } else {
            if (s.brands.some((x) => low(x.name) === low(name))) throw new Error(`Бренд «${name}» уже є — вкажіть brand, щоб змінити.`);
            s.brands.push({ id: null, name, keywords: kws });
            lines.push(`➕ Новий бренд «${name}» (слова: ${kws})`);
          }
          touched.add('brands');
          break;
        }
        case 'brand_delete': {
          const b = findBrand(op.brand);
          s.brands = s.brands.filter((x) => x !== b);
          lines.push(`🗑 Видалити бренд «${b.name}» (його товари стануть «Інші», якщо не підійде інший бренд)`); touched.add('brands');
          break;
        }
        case 'product_set': {
          const id = parseInt(op.id, 10);
          if (!id) throw new Error('product_set: немає id товару.');
          const p = products.get(id) || {};
          if (op.brand !== undefined) p.brand = op.brand === null ? null : findBrand(op.brand);
          if (op.cat !== undefined) {
            if (op.cat === null) p.cat = null;
            else {
              const cat = s.cfg.categories.find((x) => x.id === Number(op.cat));
              if (!cat) throw new Error(`Категорію ${op.cat} не знайдено.`);
              p.cat = cat;
            }
          }
          products.set(id, p);
          touched.add('products');
          break;
        }
        case 'target_set': {
          const month = String(op.month || '').slice(0, 7);
          if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('target_set: місяць у форматі YYYY-MM.');
          if (!['dept', 'src'].includes(op.kind)) throw new Error('target_set: kind — dept або src.');
          const amount = Math.round((Number(op.amount) || 0) * 100) / 100;
          if (amount < 0) throw new Error('target_set: сума не може бути відʼємною.');
          const ref = op.kind === 'dept' ? findDept(op.ref) : findSource(op.ref).src;
          if (!ref) throw new Error('target_set: не вказано, для чого таргет.');
          if (!targets.has(month)) targets.set(month, []);
          targets.get(month).push({ kind: op.kind, ref, amount });
          lines.push(`🎯 Таргет ${month}, ${op.kind === 'dept' ? 'відділ' : 'джерело'} «${ref.name}»: ${amount ? uah(amount) : 'прибрати'}`);
          touched.add('targets');
          break;
        }
        case 'settings_set': {
          const st = await getSt();
          for (const k of ['deptPriority', 'targetBase', 'compare', 'months']) {
            if (op[k] === undefined) continue;
            let v = op[k];
            if (k === 'deptPriority' && !['manager', 'office'].includes(v)) throw new Error('deptPriority — manager або office.');
            if (k === 'targetBase' && !['net', 'all'].includes(v)) throw new Error('targetBase — net або all.');
            if (k === 'compare') v = Boolean(v);
            if (k === 'months') v = Math.min(18, Math.max(1, parseInt(v, 10) || 6));
            settings[k] = v;
            const n = SETTINGS_NAMES[k];
            const show = (x) => n.values?.[String(x)] ?? String(x);
            lines.push(`⚙️ ${n.name}: ${show(st[k])} → ${show(v)}`);
          }
          touched.add('settings');
          break;
        }
        case 'ignore_set': {
          if (!['values', 'users', 'offices'].includes(op.kind)) throw new Error('ignore_set: kind — values, users або offices.');
          const value = String(op.value ?? '').trim();
          if (!value) throw new Error('ignore_set: немає значення.');
          ignores.push({ kind: op.kind, value, on: op.on !== false });
          lines.push(`${op.on !== false ? '🙈 Не показувати' : '👁 Знову показувати'} в «Потребує уваги»: ${{ values: '«Поле 1»', users: 'менеджер', offices: 'відділ CRM' }[op.kind]} «${value}»`);
          touched.add('ignore');
          break;
        }
        default:
          throw new Error(`Невідомий тип зміни «${t}».`);
      }
    }
    // товари — підписи після циклу (кілька змін одного товару — один рядок)
    if (products.size) {
      const rows = await db.all(`SELECT product_id AS id, name, brand_manual, cat_manual FROM an_products WHERE product_id IN (SELECT value FROM json_each(?))`, [JSON.stringify([...products.keys()])]);
      for (const [id, p] of products) {
        const r = rows.find((x) => x.id === id);
        if (!r) throw new Error(`Товар ${id} не знайдено в аналітиці.`);
        p.row = r;
        const parts = [];
        if (p.brand !== undefined) parts.push(`бренд → ${p.brand ? `«${p.brand.name}»` : 'автоматично'}`);
        if (p.cat !== undefined) parts.push(`категорія → ${p.cat ? `«${p.cat.name}»` : 'з CRM'}`);
        lines.push(`📦 ${r.name || `Товар ${id}`}: ${parts.join(', ')}`);
      }
    }
    if (!lines.length) throw new Error('Ці зміни нічого не змінюють — усе вже так.');
    return { s, lines, touched, products, targets, settings, ignores };
  }

  // ---------- знімок і відкат ----------
  const SNAP_TABLES = ['an_depts', 'an_sources', 'an_source_map', 'an_office_map', 'an_managers', 'an_brands', 'an_targets'];
  async function snapshot(productIds) {
    const out = {};
    for (const t of SNAP_TABLES) out[t] = await db.all(`SELECT * FROM ${t}`);
    out.products = productIds.length ? await db.all(`SELECT product_id, brand_manual, cat_manual FROM an_products WHERE product_id IN (SELECT value FROM json_each(?))`, [JSON.stringify(productIds)]) : [];
    out.settings = Object.fromEntries((await db.all(`SELECT key, value FROM settings WHERE key IN ('an_settings', 'an_ignored')`)).map((r) => [r.key, r.value]));
    return out;
  }
  async function restore(snap) {
    const st = [];
    for (const t of SNAP_TABLES) {
      st.push([`DELETE FROM ${t}`, []]);
      for (const r of snap[t] || []) {
        const cols = Object.keys(r);
        st.push([`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((k) => r[k])]);
      }
    }
    for (const p of snap.products || []) st.push([`UPDATE an_products SET brand_manual = ?, cat_manual = ? WHERE product_id = ?`, [p.brand_manual, p.cat_manual, p.product_id]]);
    for (const k of ['an_settings', 'an_ignored']) {
      if (snap.settings?.[k] === undefined) st.push([`DELETE FROM settings WHERE key = ?`, [k]]);
      else st.push([`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, snap.settings[k]]]);
    }
    await db.batch(st);
    await remap(db, await getSt());
    await rebrand(db);
    await bump();
  }

  // ---------- застосування ----------
  async function apply(c, ops) {
    const p = await plan(c, ops);
    const { s } = p;
    if (p.touched.has('structure')) {
      await inner(c, 'PUT', '/api/an/structure', { depts: s.depts.map((d) => ({ id: d.id, name: d.name, sources: d.sources.map((x) => ({ id: x.id, name: x.name, values: x.values })) })) });
    }
    // нові відділи, джерела й бренди отримали id — беремо їх за назвою
    const fresh = p.touched.has('structure') || p.touched.has('brands') ? await state(c) : s;
    // id відділу після зміни структури (видалений відділ — null)
    const alive = (id) => (id && fresh.depts.some((x) => x.id === id) ? id : null);
    const deptId = (d) => (d ? alive(d.id) || fresh.depts.find((x) => low(x.name) === low(d.name))?.id || null : null);
    const srcId = (src) => src.id || fresh.depts.flatMap((d) => d.sources).find((x) => low(x.name) === low(src.name))?.id || null;
    if (p.touched.has('managers')) {
      await inner(c, 'PUT', '/api/an/managers', s.managers.map((m) => {
        const main = m.deptRef !== undefined ? deptId(m.deptRef) : alive(m.dept);
        const extra = m.extraRefs ? m.extraRefs.map(deptId) : m.depts.map(alive);
        return { login: m.login, name: m.name, dept_id: main, depts: main ? [main, ...extra.filter((x) => x && x !== main)] : [] };
      }));
    }
    if (p.touched.has('offices')) {
      await inner(c, 'PUT', '/api/an/office-map', s.offices.map((o) => ({ office: o.office, dept_id: o.deptRef ? deptId(o.deptRef) : alive(o.dept) })).filter((o) => o.dept_id));
    }
    let brandsNow = s.brands;
    if (p.touched.has('brands')) {
      await inner(c, 'PUT', '/api/an/brands', s.brands.map((b) => ({ id: b.id, name: b.name, keywords: b.keywords })));
      brandsNow = (await state(c)).brands;
    }
    if (p.products.size) {
      const brandId = (b) => (b ? b.id || brandsNow.find((x) => low(x.name) === low(b.name))?.id || null : null);
      await inner(c, 'PUT', '/api/an/products', [...p.products].map(([id, x]) => ({
        id,
        brand_manual: x.brand !== undefined ? brandId(x.brand) : x.row.brand_manual,
        cat_manual: x.cat !== undefined ? x.cat?.id ?? null : x.row.cat_manual,
      })));
    }
    for (const [month, list] of p.targets) {
      const cur = (await inner(c, 'GET', `/api/an/targets?month=${month}`)).rows;
      const rows = new Map(cur.map((r) => [`${r.kind}:${r.ref_id}`, r]));
      for (const t of list) {
        const id = t.kind === 'dept' ? deptId(t.ref) : srcId(t.ref);
        if (!id) continue;
        if (t.amount) rows.set(`${t.kind}:${id}`, { kind: t.kind, ref_id: id, amount: t.amount });
        else rows.delete(`${t.kind}:${id}`);
      }
      await inner(c, 'PUT', '/api/an/targets', { month, rows: [...rows.values()], copyMonths: 0 });
    }
    if (Object.keys(p.settings).length) await inner(c, 'PUT', '/api/an/settings', p.settings);
    for (const x of p.ignores) await inner(c, 'PUT', '/api/an/ignore', x);
    return p;
  }

  // ---------- для ШІ ----------
  async function getSettings(c) {
    const s = await state(c);
    const [vals, attn] = await Promise.all([inner(c, 'GET', '/api/an/values'), inner(c, 'GET', '/api/an/attention')]);
    const month = kyivDay().slice(0, 7);
    const tg = await inner(c, 'GET', `/api/an/targets?month=${month}`);
    const mapped = new Set(s.depts.flatMap((d) => d.sources.flatMap((x) => x.values)));
    return {
      settings: s.cfg.settings,
      depts: s.depts.map((d) => ({ id: d.id, name: d.name, sources: d.sources.map((x) => ({ id: x.id, name: x.name, values: x.values })) })),
      managers: s.managers.map((m) => ({ login: m.login, name: m.name, dept: m.dept, depts: m.depts })),
      offices: s.cfg.offices.map((o) => ({ office: String(o.office_id), name: o.name, dept: s.offices.find((x) => x.office === String(o.office_id))?.dept || null })),
      brands: s.brands,
      categories: s.cfg.categories.slice(0, 300).map((x) => ({ id: x.id, name: x.name })),
      targetsThisMonth: { month, rows: tg.rows },
      // значення з замовлень (з кількістю): що куди потрапляє
      field1Values: (vals.values || []).slice(0, 250).map((v) => ({ value: v.value, orders: v.n, mapped: mapped.has(v.value) })),
      managerLogins: (vals.users || []).slice(0, 100).map((u) => ({ login: u.v, orders: u.n })),
      officeOrders: (vals.offices || []).slice(0, 60).map((o) => ({ office: String(o.v), orders: o.n })),
      attention: {
        unmappedValues: (attn.values || []).slice(0, 100).map((v) => ({ value: v.value, orders: v.n })),
        newManagers: (attn.users || []).map((u) => ({ login: u.v, orders: u.n })),
        officesWithoutDept: (attn.offices || []).map((o) => ({ office: String(o.v), orders: o.n })),
        products: attn.products, ignored: attn.ignored,
      },
    };
  }
  async function getProducts(c, input) {
    const r = await inner(c, 'GET', '/api/an/products');
    let list = r.products || [];
    if (input.filter === 'nobrand') list = list.filter((p) => !p.brand_id && p.brand_manual == null);
    else if (input.filter === 'nocat') list = list.filter((p) => !(p.cat_manual ?? p.category_id) && p.cat_manual == null);
    if (input.q) { const q = low(input.q); list = list.filter((p) => low(p.name).includes(q) || String(p.id) === q); }
    return { total: list.length, products: list.slice(0, 100).map((p) => ({ id: p.id, name: p.name, brand_id: p.brand_id, brand_manual: p.brand_manual, category_id: p.category_id, cat_manual: p.cat_manual, sold: p.sold })) };
  }
  // ШІ пропонує: перевірити й записати в журнал як «очікує підтвердження».
  async function propose(c, input, question) {
    const p = await plan(c, input.ops);
    const summary = String(input.summary || '').trim().slice(0, 500);
    const r = await db.run(`INSERT INTO an_ai_changes (created_at, asked_by, question, summary, ops, preview, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [nowIso(), who(c.get('user')), String(question || '').slice(0, 2000), summary, JSON.stringify(input.ops), JSON.stringify(p.lines)]);
    return { id: r.lastId, summary, lines: p.lines };
  }

  async function runTool(c, name, input, question, proposals) {
    if (name === 'get_settings') return getSettings(c);
    if (name === 'get_products') return getProducts(c, input);
    if (name === 'propose_changes') {
      const pr = await propose(c, input, question);
      proposals.push(pr);
      return { proposal: pr.id, status: 'очікує підтвердження користувача', lines: pr.lines };
    }
    return undefined;
  }

  // ---------- журнал і дії ----------
  const pub = (r) => ({
    id: r.id, created_at: r.created_at, asked_by: r.asked_by, question: r.question, summary: r.summary, lines: JSON.parse(r.preview || '[]'),
    status: r.status, done_by: r.done_by, done_at: r.done_at, error: r.error, reverted_by: r.reverted_by, reverted_at: r.reverted_at,
  });
  const rowOf = async (id) => {
    const r = await db.get(`SELECT * FROM an_ai_changes WHERE id = ?`, [parseInt(id, 10) || 0]);
    if (!r) throw fail(404, 'Зміну не знайдено.');
    return r;
  };
  app.get('/api/an/ai/changes', async (c) => {
    const rows = await db.all(`SELECT * FROM an_ai_changes ORDER BY id DESC LIMIT 200`);
    const lastApplied = rows.find((r) => r.status === 'applied')?.id || null;
    return c.json({ rows: rows.map((r) => ({ ...pub(r), can_revert: r.id === lastApplied })) });
  });
  app.post('/api/an/ai/changes/:id/apply', async (c) => {
    const r = await rowOf(c.req.param('id'));
    if (r.status !== 'pending') throw fail(400, r.status === 'applied' ? 'Ці зміни вже застосовано.' : 'Ці зміни вже скасовано або вони не вдались — попросіть ШІ запропонувати заново.');
    const claim = await db.run(`UPDATE an_ai_changes SET status = 'applying' WHERE id = ? AND status = 'pending'`, [r.id]);
    if (!claim.changes) throw fail(409, 'Зміни вже застосовуються.');
    const ops = JSON.parse(r.ops || '[]');
    const pids = ops.filter((o) => o?.type === 'product_set').map((o) => parseInt(o.id, 10)).filter(Boolean);
    const snap = await snapshot(pids);
    const u = c.get('user');
    try {
      const p = await apply(c, ops);
      await db.run(`UPDATE an_ai_changes SET status = 'applied', done_by = ?, done_at = ?, snapshot = ?, preview = ?, error = '' WHERE id = ?`,
        [who(u), nowIso(), JSON.stringify(snap), JSON.stringify(p.lines), r.id]);
      await logAudit(db, { user: u, kind: 'analytics', refId: r.id, action: `застосовано зміни аналітики від ШІ (запит: ${r.asked_by || '—'}): ${r.summary}`.slice(0, 500), changes: p.lines.slice(0, 50) }).catch(() => 0);
      return c.json({ ok: true, change: pub(await rowOf(r.id)) });
    } catch (e) {
      // частково застосовано — повертаємо як було
      await restore(snap).catch(() => 0);
      if (e.pending) { await db.run(`UPDATE an_ai_changes SET status = 'pending' WHERE id = ?`, [r.id]); throw e; }
      const msg = String(e.message || e).slice(0, 500);
      await db.run(`UPDATE an_ai_changes SET status = 'failed', done_by = ?, done_at = ?, error = ? WHERE id = ?`, [who(u), nowIso(), msg, r.id]);
      throw fail(400, `Не вдалося застосувати: ${msg}. Налаштування лишились як були.`);
    }
  });
  app.post('/api/an/ai/changes/:id/cancel', async (c) => {
    const r = await rowOf(c.req.param('id'));
    if (r.status !== 'pending') throw fail(400, 'Скасувати можна лише зміни, що чекають підтвердження.');
    await db.run(`UPDATE an_ai_changes SET status = 'cancelled', done_by = ?, done_at = ? WHERE id = ? AND status = 'pending'`, [who(c.get('user')), nowIso(), r.id]);
    return c.json({ ok: true, change: pub(await rowOf(r.id)) });
  });
  app.post('/api/an/ai/changes/:id/revert', async (c) => {
    const r = await rowOf(c.req.param('id'));
    if (r.status !== 'applied') throw fail(400, 'Відкотити можна лише застосовані зміни.');
    const last = await db.get(`SELECT id FROM an_ai_changes WHERE status = 'applied' ORDER BY id DESC LIMIT 1`);
    if (last?.id !== r.id) throw fail(400, 'Відкотити можна лише останню застосовану зміну — спершу відкотіть пізніші.');
    await restore(JSON.parse(r.snapshot || '{}'));
    const u = c.get('user');
    await db.run(`UPDATE an_ai_changes SET status = 'reverted', reverted_by = ?, reverted_at = ? WHERE id = ?`, [who(u), nowIso(), r.id]);
    await logAudit(db, { user: u, kind: 'analytics', refId: r.id, action: `відкочено зміни аналітики від ШІ: ${r.summary}`.slice(0, 500) }).catch(() => 0);
    return c.json({ ok: true, change: pub(await rowOf(r.id)) });
  });

  return { runTool, allowed };
}
