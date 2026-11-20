// Телефон → посилання tel:+380… (клік відкриває MicroSIP / Zoiper / Binotel / набір на телефоні).
import assert from 'node:assert/strict';

globalThis.document = { querySelector() {}, querySelectorAll() { return []; }, addEventListener() {}, body: {} };
globalThis.MutationObserver = class { observe() {} };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
const { telHref, telLink } = await import('../public/core/ui.js');

for (const p of ['+380674951531', '0674951531', '380674951531', '674951531', '067 495 15 31', '+38 (067) 495-15-31']) assert.equal(telHref(p), 'tel:+380674951531', p);
assert.equal(telHref(''), '');
assert.equal(telHref('abc'), '');
assert.equal(telLink('0674951531', '067 495 15 31'), '<a class="tel-a" href="tel:+380674951531" title="Подзвонити">067 495 15 31</a>');
assert.equal(telLink('', 'немає <b>'), 'немає &lt;b&gt;', 'без номера — просто текст, екранований');
console.log('OK — телефони: посилання tel:+380…');
