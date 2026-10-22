// Спільне для всіх сторінок інтерфейсу: запити до API, повідомлення, діалоги, дати, картинки, друк.
import { esc } from '../invoice.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const main = $('#main');
export const MASK = '••••••';
export const todayKyiv = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());

// Сервер на Cloudflare може відповісти «обробка триває» (202), якщо пошук у LP-CRM довгий, — тоді повторюємо запит.
let onPending = null;
let onUnauthorized = () => {};
// Хто реагує на «пошук триває» (202) і на «потрібно увійти» (401) — задає app.js і сторінки.
export const setPending = (fn) => { onPending = fn; };
export const setUnauthorized = (fn) => { onUnauthorized = fn; };
export async function api(method, url, body, attempt = 0) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Немає зв’язку із сервером — зміни не збережено. Перевірте інтернет і спробуйте ще раз.');
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 202 && json.pending) {
    if (attempt >= 60) throw new Error('Пошук триває надто довго. Спробуйте ще раз або введіть код замовлення.');
    onPending?.(attempt + 1);
    await new Promise((r) => setTimeout(r, 400));
    return api(method, url, body, attempt + 1);
  }
  if (res.status === 401 && !url.startsWith('/api/auth/')) { onUnauthorized(); throw new Error(json.error || 'Потрібно увійти'); }
  if (!res.ok) throw Object.assign(new Error(json.error || (res.status >= 500 ? 'Сервер не зміг виконати дію. Спробуйте ще раз за хвилину.' : 'Дію не виконано. Оновіть сторінку і спробуйте ще раз.')), { status: res.status, data: json });
  return json;
}

// Рядки таблиць, що відкриваються кліком, доступні й з клавіатури (Tab, Enter / Пробіл).
new MutationObserver(() => {
  for (const el of document.querySelectorAll('tr.click:not([tabindex])')) el.tabIndex = 0;
}).observe(document.body, { childList: true, subtree: true });
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('tr.click')) { e.preventDefault(); e.target.click(); }
});

let toastTimer;
export function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), bad ? 5000 : 2600);
}

// Діалог: Esc закриває, Tab не виходить за межі вікна, після закриття фокус повертається туди, звідки відкрили.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let modalSeq = 0;
export function modal(title, bodyHtml, { footer = '', wide = false, focus = '' } = {}) {
  const opener = document.activeElement;
  const titleId = `modal-title-${++modalSeq}`;
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" style="${wide ? 'width:min(1000px,100%)' : ''}">
    <div class="modal-head"><h3 id="${titleId}">${esc(title)}</h3><button class="btn sm icon" data-close aria-label="Закрити вікно">✕</button></div>
    <div class="modal-body">${bodyHtml}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    bg.remove();
    document.removeEventListener('keydown', onKey, true);
    if (opener && document.contains(opener)) opener.focus?.();
  };
  const onKey = (e) => {
    if (!document.contains(bg)) return;
    const all = document.querySelectorAll('.modal-bg');
    if (all[all.length - 1] !== bg) return; // діє лише верхнє вікно
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...bg.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(bg);
  const start = (focus && bg.querySelector(focus)) || bg.querySelector('.modal-body ' + FOCUSABLE) || bg.querySelector('[data-close]');
  start?.focus();
  return { el: bg, close };
}

// Підтвердження незворотної дії: назва об'єкта в заголовку, кнопка з дієсловом, фокус на «Скасувати».
export function confirmDanger(title, text, verb) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(title, `<p style="margin:0">${text}</p>`, {
      footer: `<button class="btn" data-close id="cdNo">Скасувати</button><button class="btn danger solid" id="cdYes">${esc(verb)}</button>`,
      focus: '#cdNo',
    });
    $('#cdYes', m.el).onclick = () => { done = true; m.close(); resolve(true); };
    new MutationObserver((_, obs) => { if (!document.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } }).observe(document.body, { childList: true });
  });
}

export const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Стиснення зображень (логотип, підпис, печатка) перед збереженням.
export function readImage(file, max = 700) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Друк: HTML у прихований блок, чекаємо картинки (підпис, печатка), потім вікно друку.
export function printHtml(html) {
  $('#print-root').innerHTML = html;
  const imgs = $$('#print-root img');
  Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))).then(() => {
    window.print();
  });
}
