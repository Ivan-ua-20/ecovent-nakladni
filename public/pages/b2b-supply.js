// Закупівля від нас: адмін обирає партнера (його бренди й маржа), товари й кількість, оплату (передоплата / відстрочка),
// отримання (на склад партнера / клієнтам / самовивіз) і надсилає партнеру на підтвердження.
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast, confirmDanger } from '../core/ui.js';
import { uah } from './b2b-shared.js';

const DELIV = [
  ['warehouse', '🏬 На склад партнера', 'Усю закупівлю відправляємо Новою поштою на склад партнера — одним замовленням LP-CRM після підтвердження.'],
  ['np', '📦 Відправка клієнтам', 'Партнер розписує закупівлю на замовлення своїх клієнтів (як зараз).'],
  ['pickup', '🚗 Самовивіз', 'Партнер забирає всю закупівлю зі складу сам.'],
];
const pctTxt = (v) => `${String(Number(v) || 0).replace('.', ',')}%`;

export async function viewAdminSupplyForm(preset = '') {
  const partners = (await api('GET', '/api/b2b/partners')).filter((p) => p.active);
  const st = { pid: preset || '', opt: null, qty: new Map(), brand: '', q: '', terms: 'prepay', days: 14, delivery: 'warehouse', ship: null, comment: '' };
  main.innerHTML = `
    <div class="head-row"><h2>Нова закупівля для партнера</h2><a class="btn" href="#/b2borders">← До списку</a></div>
    <div class="alert info" style="margin-bottom:12px">Партнер отримає закупівлю в кабінеті й повідомлення в Telegram (особисто і в групу партнера),
      підтвердить її й обере юрособу для рахунку. Ціни — за маржею партнера на день створення.</div>
    <label class="f" style="max-width:420px"><span>Партнер</span><select id="asP"><option value="">— оберіть партнера —</option>
      ${partners.map((p) => `<option value="${p.id}" ${String(p.id) === String(st.pid) ? 'selected' : ''}>${esc(p.name)}${p.paused ? ' (пауза)' : ''}</option>`).join('')}</select></label>
    <div id="asBody" style="margin-top:14px"></div>`;
  $('#asP').onchange = (e) => { st.pid = e.target.value; st.qty.clear(); st.brand = ''; load(); };
  if (st.pid) load();

  async function load() {
    const body = $('#asBody');
    if (!st.pid) { body.innerHTML = ''; return; }
    body.innerHTML = '<div class="small muted"><span class="spinner"></span> Завантажую бренди й ціни партнера…</div>';
    try { st.opt = await api('GET', `/api/b2b/partners/${st.pid}/supply-options`); } catch (e) { body.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; return; }
    const p = st.opt.partner;
    st.ship = { ...p.warehouse };
    if (p.postpay_days) st.days = p.postpay_days;
    draw();
  }

  const total = () => st.opt.products.reduce((t, x) => t + (st.qty.get(x.product_id) || 0) * x.price, 0);
  const count = () => [...st.qty.values()].filter((n) => n > 0).length;

  function draw() {
    const { partner: p, brands, products } = st.opt;
    const body = $('#asBody');
    if (!products.length) {
      body.innerHTML = `<div class="card empty"><div class="big">Партнеру не відкрито жодного бренду</div>Увімкніть бренди й маржу в картці партнера («Партнери» → ${esc(p.name)}).</div>`;
      return;
    }
    body.innerHTML = `
      ${!p.entities ? '<div class="alert warn" style="margin-bottom:10px">У партнера ще немає юросіб — щоб підтвердити закупівлю, йому доведеться додати юрособу в кабінеті.</div>' : ''}
      ${p.paused ? '<div class="alert warn" style="margin-bottom:10px">Партнер на паузі — сам він закупівлі зараз не оформлює.</div>' : ''}
      <div class="form-page">
        <div class="form-stack">
          <div class="card form-stack">
            <h3>Товари</h3>
            <div class="btn-row" style="flex-wrap:wrap"><button class="chip ${st.brand ? '' : 'on'}" data-br="">Усі бренди</button>
              ${brands.map((b) => `<button class="chip ${String(st.brand) === String(b.id) ? 'on' : ''}" data-br="${b.id}">${esc(b.name)} · маржа ${pctTxt(b.margin)}</button>`).join('')}</div>
            <input id="asQ" placeholder="Пошук: назва або артикул" value="${esc(st.q)}" aria-label="Пошук товару">
            <div class="table-wrap" style="max-height:60vh;overflow:auto"><table class="list"><thead><tr><th>Товар</th><th class="r">РРЦ</th><th class="r">Ціна партнера</th><th class="r" style="width:110px">К-сть</th><th class="r">Сума</th></tr></thead>
              <tbody id="asRows"></tbody></table></div>
          </div>
          <label class="f card"><span>Коментар для партнера</span><textarea id="asCom" rows="2" maxlength="1000">${esc(st.comment)}</textarea></label>
        </div>
        <div class="form-stack">
          <div class="card form-stack">
            <h3>Оплата</h3>
            <label class="check"><input type="radio" name="asT" value="prepay" ${st.terms === 'prepay' ? 'checked' : ''}> Передоплата (звичайна)</label>
            <label class="check"><input type="radio" name="asT" value="postpay" ${st.terms === 'postpay' ? 'checked' : ''}> Відстрочка оплати</label>
            <label class="f" id="asDaysF" ${st.terms === 'postpay' ? '' : 'hidden'}><span>Днів від дати рахунку</span><input id="asDays" type="number" min="1" max="90" value="${st.days}" style="max-width:120px"></label>
            <div class="small muted">${p.postpay_days ? `Партнеру відкрито відстрочку ${p.postpay_days} дн.` : 'Партнеру відстрочку не відкрито — для цієї закупівлі можна задати будь-яку (ліміти не перевіряються).'}</div>
          </div>
          <div class="card form-stack">
            <h3>Отримання</h3>
            ${DELIV.map(([k, label, hint]) => `<label class="check" style="align-items:flex-start"><input type="radio" name="asD" value="${k}" ${st.delivery === k ? 'checked' : ''}>
              <span>${label}<div class="small muted">${hint}</div></span></label>`).join('')}
            <div id="asShip" class="form-stack" ${st.delivery === 'warehouse' ? '' : 'hidden'}>
              <label class="f"><span>Отримувач (ПІБ)</span><input id="asSN" value="${esc(st.ship.name)}" autocomplete="off"></label>
              <label class="f"><span>Телефон отримувача</span><input id="asSP" value="${esc(st.ship.phone)}" inputmode="tel" placeholder="0501234567"></label>
              <label class="f"><span>Місто й відділення Нової пошти</span><input id="asSA" value="${esc(st.ship.address)}" placeholder="Київ, відділення № 25"></label>
              <div class="small muted">Запам’ятається як склад партнера для наступних закупівель.</div>
            </div>
          </div>
          <div class="card form-stack" style="position:sticky;top:8px">
            <div>Позицій: <b id="asCnt">0</b> · Разом: <b id="asSum">0,00 грн</b> <span class="small muted">(з ПДВ)</span></div>
            <button class="btn primary" id="asSend">Надіслати партнеру на підтвердження</button>
          </div>
        </div>
      </div>`;
    rows();
    sums();
    $$('[data-br]').forEach((b) => (b.onclick = () => { st.brand = b.dataset.br; draw(); }));
    $('#asQ').oninput = (e) => { st.q = e.target.value; rows(); };
    $('#asCom').oninput = (e) => { st.comment = e.target.value; };
    $$('[name=asT]').forEach((r) => (r.onchange = () => { st.terms = r.value; $('#asDaysF').hidden = st.terms !== 'postpay'; }));
    $('#asDays').oninput = (e) => { st.days = e.target.value; };
    $$('[name=asD]').forEach((r) => (r.onchange = () => { st.delivery = r.value; $('#asShip').hidden = st.delivery !== 'warehouse'; }));
    [['#asSN', 'name'], ['#asSP', 'phone'], ['#asSA', 'address']].forEach(([sel, k]) => { $(sel).oninput = (e) => { st.ship[k] = e.target.value; }; });
    $('#asSend').onclick = send;
  }

  function rows() {
    const q = st.q.trim().toLowerCase();
    const list = st.opt.products.filter((x) => (!st.brand || String(x.brand_id) === String(st.brand))
      && (!q || x.name.toLowerCase().includes(q) || x.article.toLowerCase().includes(q)));
    // Обрані товари — завжди вгорі, навіть якщо не підходять під фільтр.
    const chosen = st.opt.products.filter((x) => st.qty.get(x.product_id) > 0 && !list.includes(x));
    $('#asRows').innerHTML = [...chosen, ...list].slice(0, 400).map((x) => {
      const n = st.qty.get(x.product_id) || 0;
      return `<tr${n ? ' class="sel"' : ''}><td>${esc(x.name)}${x.article ? `<div class="small muted">${esc(x.article)}</div>` : ''}</td>
        <td class="r small muted nowrap">${money(x.rrp)}</td><td class="r nowrap"><b>${money(x.price)}</b><div class="small muted">−${pctTxt(x.margin)}</div></td>
        <td class="r"><input type="number" min="0" step="1" data-q="${x.product_id}" value="${n || ''}" style="width:90px" aria-label="Кількість: ${esc(x.name)}"></td>
        <td class="r nowrap" data-s="${x.product_id}">${n ? money(n * x.price) : '—'}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">Нічого не знайдено.</td></tr>';
    $$('[data-q]').forEach((i) => (i.oninput = () => {
      const id = Number(i.dataset.q);
      const n = Math.max(0, Math.floor(Number(i.value) || 0));
      if (n) st.qty.set(id, n); else st.qty.delete(id);
      const x = st.opt.products.find((y) => y.product_id === id);
      $(`[data-s="${id}"]`).textContent = n ? money(n * x.price) : '—';
      sums();
    }));
  }
  function sums() { $('#asCnt').textContent = count(); $('#asSum').textContent = uah(total()); }

  async function send(e) {
    const items = [...st.qty].filter(([, n]) => n > 0).map(([product_id, qty]) => ({ product_id, qty }));
    if (!items.length) { toast('Вкажіть кількість хоча б одного товару', true); return; }
    const p = st.opt.partner;
    const terms = st.terms === 'postpay' ? `відстрочка ${st.days} дн.` : 'передоплата';
    const deliv = DELIV.find((d) => d[0] === st.delivery)[1];
    if (!(await confirmDanger(`Надіслати закупівлю «${p.name}» на ${uah(total())}?`, `${items.length} поз. · ${esc(terms)} · ${esc(deliv)}. Партнер отримає її на підтвердження.`, 'Надіслати партнеру'))) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/b2b/orders', { partner_id: p.id, items, pay_terms: st.terms, pay_days: st.days, delivery: st.delivery, ship_to: st.delivery === 'warehouse' ? st.ship : undefined, comment: st.comment });
      toast(`Закупівлю ${r.number} надіслано партнеру на підтвердження`);
      location.hash = `#/b2borders/${r.id}`;
    } catch (er) { toast(er.message, true); btn.disabled = false; }
  }
}
