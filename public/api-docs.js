// Базова адреса — з поточного домену (якщо документацію відкрито з іншої адреси сайту).
const base = location.origin.startsWith('http') && !/localhost|127\.0\.0\.1/.test(location.origin) ? location.origin : 'https://ecovent-nakladni.pages.dev';
document.querySelectorAll('pre code, code.base').forEach((el) => { el.innerHTML = el.innerHTML.replaceAll('https://ecovent-nakladni.pages.dev', base); });
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('pre[data-c]').forEach((p) => { p.hidden = p.dataset.c !== b.dataset.t; });
}));
