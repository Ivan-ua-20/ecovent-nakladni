// Кабінет партнера (B2B): каталог увімкнених брендів з РРЦ і ціною партнера, інструкція.
import { esc, money } from '../invoice.js';
import { $, $$, main, api } from '../core/ui.js';

export function createPartnerPages() {
  let filter = { brand: '', q: '' };

  async function viewPartnerCatalog() {
    const { partner, brands, products } = await api('GET', '/api/b2b/p/catalog');
    const draw = () => {
      const q = filter.q.toLowerCase();
      const list = products.filter((p) => (!filter.brand || String(p.brand_id) === String(filter.brand))
        && (!q || p.name.toLowerCase().includes(q) || String(p.article || '').toLowerCase().includes(q)));
      $('#pcList').innerHTML = list.length ? `<table class="list"><thead><tr><th></th><th>Товар</th><th class="hide-m">Бренд</th><th class="r">РРЦ</th><th class="r">Ваша ціна</th></tr></thead><tbody>
        ${list.map((p) => `<tr>
          <td style="width:56px">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" style="width:48px;height:48px;object-fit:contain">` : ''}</td>
          <td><b>${esc(p.name)}</b>${p.article ? `<div class="small muted">${esc(p.article)}</div>` : ''}</td>
          <td class="small hide-m">${esc(p.brand)}</td>
          <td class="r small muted">${money(p.rrp)} грн</td>
          <td class="r"><b>${money(p.price)} грн</b></td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="card empty"><div class="big">Нічого не знайдено</div>Спробуйте інший пошук або бренд.</div>';
    };
    main.innerHTML = `
      <div class="head-row"><h2>Каталог — ${esc(partner.name)}</h2></div>
      ${products.length ? `
        <div class="btn-row" style="margin-bottom:12px;flex-wrap:wrap">
          <button class="chip ${filter.brand ? '' : 'on'}" data-br="">Усі бренди</button>
          ${brands.map((b) => `<button class="chip ${String(filter.brand) === String(b.id) ? 'on' : ''}" data-br="${b.id}">${esc(b.name)}</button>`).join('')}
          <input id="pcQ" placeholder="Пошук за назвою або артикулом" value="${esc(filter.q)}" style="max-width:280px">
        </div>
        <div class="small muted" style="margin-bottom:8px">Ціни з ПДВ. «Ваша ціна» — ціна для вас як партнера; РРЦ — рекомендована роздрібна ціна.</div>
        <div id="pcList"></div>`
        : '<div class="card empty"><div class="big">Каталог ще порожній</div>Ваш менеджер ще не відкрив вам бренди. Зверніться до нього — після цього товари з’являться тут.</div>'}`;
    if (!products.length) return;
    $$('[data-br]').forEach((b) => (b.onclick = () => { filter.brand = b.dataset.br; viewPartnerCatalog(); }));
    $('#pcQ').oninput = (e) => { filter.q = e.target.value.trim(); draw(); };
    draw();
  }

  function viewPartnerHelp() {
    main.innerHTML = `
      <h2>Інструкція для партнера</h2>
      <div class="card form-stack" style="max-width:820px">
        <h3>1. Каталог</h3>
        <p>У розділі «Каталог» — товари брендів, відкритих вам менеджером. Для кожного товару видно <b>РРЦ</b> (рекомендовану роздрібну ціну)
          і <b>вашу ціну</b> як партнера. Ціни з ПДВ. Пошук — за назвою або артикулом; кнопки вгорі — фільтр за брендом.</p>
        <h3>2. Сповіщення в Telegram</h3>
        <p>Натисніть «Telegram» угорі сторінки, потім «Підключити Telegram» і «Start» у боті. Сюди приходитимуть повідомлення про зміну цін
          і про ваші замовлення.</p>
        <h3>3. Пароль і безпека</h3>
        <p>Змінити пароль — кнопка «Пароль» угорі. Не передавайте логін іншим: для кожного співробітника менеджер може створити окремий вхід.</p>
        <h3>4. Замовлення</h3>
        <p class="muted">Розділи «Мої юрособи», «Закупівлі» та «Замовлення клієнтів» з’являться тут найближчим часом — інструкцію буде доповнено.</p>
        <h3>Питання</h3>
        <p>Звертайтеся до вашого менеджера в Ековент Дистриб’юшн.</p>
      </div>`;
  }

  return { viewPartnerCatalog, viewPartnerHelp };
}
