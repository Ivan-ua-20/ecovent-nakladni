// Новини Ековент без входу: стрічка публічних статей і стаття (лише РРЦ, без партнерських цін), кнопка «Увійти».
// Показується замість форми входу (app.js → showAuth); після входу — туди ж, куди й раніше
// (якщо відкривали новину — до неї в кабінеті: #/news/12 → кабінет партнера або адмінка новин).
import { esc } from '../invoice.js';
import { $, $$, api, toast } from '../core/ui.js';
import { articleHtml, cardHtml } from './b2b-news.js';

const st = { cat: '' };

// box — контейнер сторінки; onLogin — показати форму входу. Повертає false, якщо публічних новин немає (тоді — одразу вхід).
export async function renderPublicNews(box, { onLogin }) {
  const m = /^#\/news(?:\/(\d+))?/.exec(location.hash || '');
  const id = m?.[1] || '';
  let list;
  try { list = await api('GET', '/api/public/news'); } catch { return false; }
  if (!list.rows.length && !id) return false;
  document.body.classList.add('pub-mode');
  const top = `<header class="pub-top"><div class="brand"><span class="brand-mark"></span>Ековент B2B</div><span class="muted grow" style="color:#9fb5ab">Новини для партнерів і дилерів</span>
      <button type="button" class="btn primary" data-login>Увійти</button></header>`;
  if (id) {
    let n;
    try { n = await api('GET', `/api/public/news/${id}`); } catch (er) {
      box.innerHTML = `${top}<div class="pub-body"><div class="card empty"><div class="big">${esc(er.message)}</div><a class="btn" href="#/news">← Усі новини</a> <button type="button" class="btn primary" data-login>Увійти</button></div></div>`;
      wire(box, onLogin);
      return true;
    }
    box.innerHTML = `${top}<div class="pub-body">${articleHtml(n, { back: '#/news', pub: true })}
      <div class="pub-cta"><div class="grow"><b>Ви наш партнер?</b><div class="small">Увійдіть, щоб бачити свої ціни, усі новини й оформлювати закупівлі.</div></div><button type="button" class="btn primary" data-login>Увійти в кабінет</button></div></div>`;
    document.title = `${n.title} — Ековент B2B`;
    wire(box, onLogin, n);
    return true;
  }
  const cats = [...new Set(list.rows.map((r) => r.category))];
  const draw = () => {
    const rows = list.rows.filter((r) => !st.cat || r.category === st.cat);
    const pinned = rows.filter((r) => r.pinned);
    const rest = rows.filter((r) => !r.pinned);
    $('#pubList', box).innerHTML = `${pinned.map((r) => cardHtml(r, true, '#/news/')).join('')}<div class="nw-grid">${rest.map((r) => cardHtml(r, false, '#/news/')).join('')}</div>`;
    $$('[data-cat]', box).forEach((b) => b.classList.toggle('on', b.dataset.cat === st.cat));
  };
  box.innerHTML = `${top}<div class="pub-body">
      <div class="head-row"><h2>Новини Ековент</h2></div>
      ${cats.length > 1 ? `<div class="f-chips" style="margin-bottom:14px"><button type="button" class="chip" data-cat="">Усі · ${list.rows.length}</button>${cats.map((k) => `<button type="button" class="chip" data-cat="${esc(k)}">${esc(list.cats[k] || k)}</button>`).join('')}</div>` : ''}
      <div id="pubList"></div>
      <div class="pub-cta"><div class="grow"><b>Ви наш партнер?</b><div class="small">Увійдіть, щоб бачити свої ціни, усі новини (зокрема внутрішні — ціни, умови, акції) і оформлювати закупівлі.</div></div><button type="button" class="btn primary" data-login>Увійти в кабінет</button></div>
    </div>`;
  document.title = 'Новини — Ековент B2B';
  $$('[data-cat]', box).forEach((b) => (b.onclick = () => { st.cat = b.dataset.cat; draw(); }));
  draw();
  wire(box, onLogin);
  return true;
}

function wire(box, onLogin, n = null) {
  $$('[data-login]', box).forEach((b) => (b.onclick = () => onLogin()));
  const sh = $('[data-share]', box);
  if (sh && n) sh.onclick = async () => {
    const url = `${location.origin}/api/n/${n.id}`;
    try { await navigator.clipboard.writeText(url); toast('Посилання скопійовано — у Telegram покажеться з фото й заголовком'); } catch { prompt('Скопіюйте посилання', url); }
  };
}
