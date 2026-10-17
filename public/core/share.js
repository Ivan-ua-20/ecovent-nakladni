// Вікно «Надіслати»: файл Word через системне меню «Поділитися» (телефон, Chrome/Edge на Windows, Safari на Mac),
// текст із посиланням — у Telegram, Viber, WhatsApp або в буфер обміну (Instagram та інші чати).
// Отримувача обирає менеджер у самому месенджері — сайт нікому нічого не надсилає сам.
import { esc } from '../invoice.js';
import { $, modal, toast } from './ui.js';

// Чи вміє браузер передавати файли в меню «Поділитися».
export function canShareFiles() {
  try {
    const probe = new File(['x'], 'probe.docx', { type: DOCX_TYPE });
    return Boolean(navigator.canShare?.({ files: [probe] }));
  } catch { return false; }
}
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const canShareText = () => typeof navigator.share === 'function';

// Адреси месенджерів з готовим текстом (отримувача менеджер вибирає сам).
export function messengerLinks(text, url = '') {
  const t = encodeURIComponent(text);
  const rest = url ? encodeURIComponent(text.replace(url, '').trim()) : '';
  return {
    telegram: url ? `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${rest}` : `https://t.me/share/url?url=${t}`,
    viber: `viber://forward?text=${t}`,
    whatsapp: `https://wa.me/?text=${t}`,
  };
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Текст скопійовано — вставте його в чат клієнта'); }
  catch { window.prompt('Скопіюйте текст:', text); }
}

/**
 * @param {object} o
 * @param {string} o.title     заголовок вікна, напр. «Надіслати рахунок № 107568»
 * @param {string} o.text      повідомлення клієнту (з посиланням, якщо воно є)
 * @param {string} [o.url]     посилання на оплату
 * @param {() => Promise<{blob: Blob, name: string}>} [o.makeFile]  файл Word (готується одразу при відкритті)
 * @param {() => void} [o.download]  завантажити файл, якщо поділитися ним не можна
 */
export function sendDialog({ title, text, url = '', makeFile, download }) {
  const files = Boolean(makeFile) && canShareFiles();
  const links = messengerLinks(text, url);
  const m = modal(title, `
    <div class="send-box">
      ${makeFile ? `<section class="send-sec">
        <h4>Файл Word</h4>
        <div class="btn-row">
          ${files ? '<button class="btn primary" id="sdShareFile" disabled><span class="spinner"></span> Готую файл…</button>' : ''}
          <button class="btn${files ? '' : ' primary'}" id="sdDownload">Завантажити Word</button>
        </div>
        <div class="small muted">${files
          ? 'Відкриється меню «Поділитися»: виберіть месенджер і клієнта. Разом з файлом піде текст нижче.'
          : 'Цей браузер не передає файли в месенджери напряму — завантажте файл і прикріпіть його в чаті клієнта.'}</div>
      </section>` : ''}
      <section class="send-sec">
        <h4>${url ? 'Посилання на оплату' : 'Повідомлення'}</h4>
        <label class="f"><span>Текст для клієнта</span><textarea id="sdText" rows="4">${esc(text)}</textarea></label>
        <div class="btn-row send-apps">
          ${canShareText() ? '<button class="btn" id="sdShareText">Поділитися…</button>' : ''}
          <a class="btn" id="sdTg" href="${esc(links.telegram)}" target="_blank" rel="noopener">Telegram</a>
          <a class="btn" id="sdViber" href="${esc(links.viber)}">Viber</a>
          <a class="btn" id="sdWa" href="${esc(links.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>
          <button class="btn" id="sdCopy">Скопіювати текст</button>
        </div>
        <div class="small muted">Для Instagram, Messenger та інших чатів — скопіюйте текст і вставте його в розмову з клієнтом.</div>
      </section>
    </div>`, { footer: '<button class="btn" data-close>Закрити</button>', wide: false });

  const textNow = () => $('#sdText', m.el).value.trim() || text;
  // Текст можна поправити перед надсиланням — посилання месенджерів оновлюються.
  $('#sdText', m.el).oninput = () => {
    const l = messengerLinks(textNow(), textNow().includes(url) ? url : '');
    $('#sdTg', m.el).href = l.telegram;
    $('#sdViber', m.el).href = l.viber;
    $('#sdWa', m.el).href = l.whatsapp;
  };
  $('#sdCopy', m.el).onclick = () => copyText(textNow());
  const shareText = $('#sdShareText', m.el);
  if (shareText) shareText.onclick = async () => {
    try { await navigator.share({ title, text: textNow() }); } catch (e) { if (e?.name !== 'AbortError') copyText(textNow()); }
  };
  if (makeFile) {
    $('#sdDownload', m.el).onclick = () => download?.();
    // Файл готуємо заздалегідь: меню «Поділитися» відкривається лише одразу після натискання.
    if (files) {
      const btn = $('#sdShareFile', m.el);
      makeFile().then(({ blob, name }) => {
        const file = new File([blob], name, { type: DOCX_TYPE });
        btn.disabled = false;
        btn.textContent = 'Поділитися файлом Word…';
        btn.onclick = async () => {
          try { await navigator.share({ files: [file], title, text: textNow() }); }
          catch (e) { if (e?.name !== 'AbortError') toast('Не вдалося поділитися файлом — завантажте його і прикріпіть у чаті.', true); }
        };
      }).catch((e) => { btn.textContent = 'Файл не створено'; toast(e.message, true); });
    }
  }
  return m;
}
