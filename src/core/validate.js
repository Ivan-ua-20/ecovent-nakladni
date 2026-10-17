// Перевірка даних, які потім вставляються в HTML (логотип, підпис, печатка ФОП).
// Дозволяємо лише картинки у форматі data:image/…;base64 — інакше значення могло б «вийти» з атрибута src
// і виконати чужий код у браузері (XSS).

export const IMAGE_FIELDS = ['logo', 'signature', 'stamp'];
const MAX_IMAGE_CHARS = 3_000_000; // ≈ 2,2 МБ картинки
const IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

// true — порожньо або коректна картинка
export const isSafeImage = (v) => {
  const s = String(v ?? '');
  return s === '' || (s.length <= MAX_IMAGE_CHARS && IMAGE_RE.test(s));
};

// Перевіряє картинки в тілі запиту; помилка — з назвою поля.
export function checkImages(body, fail) {
  for (const k of IMAGE_FIELDS) {
    if (body[k] !== undefined && !isSafeImage(body[k])) {
      throw fail(400, `Поле «${k}»: потрібна картинка PNG, JPEG, WebP або GIF (до 2 МБ).`);
    }
  }
}

// Для імпорту: некоректні картинки просто прибираємо.
export function dropUnsafeImages(row) {
  const out = { ...row };
  for (const k of IMAGE_FIELDS) if (k in out && !isSafeImage(out[k])) out[k] = '';
  return out;
}
