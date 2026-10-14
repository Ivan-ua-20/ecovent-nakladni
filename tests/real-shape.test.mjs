// Перевірка на реальній структурі відповіді LP-CRM (дані знеособлено).
import assert from 'node:assert/strict';
import { findOrders } from '../src/lpcrm.js';
import { normalizeOrder } from '../src/normalize.js';
const resp = { status: 'ok', data: { id: '106593', order_id: '1791608184877250', bayer_name: 'Тест Покупець', phone: '380750000000',
  total: '22200.00', datetime: '2026-10-10 07:56:24', status: '11', delivery_id: '1', delivery_adress: 'Билбасівка, Відділення №1',
  ttn: '20451557024903', office: '4', payment: '16', delivery: 'Нова Пошта', comment: 'Поклеїти плівку',
  products: [
    { type: 'sale', product_id: '965', name: 'Смартфон iHunt Titan Night Hunter [04979]', price: '21900.00', quantity: '1' },
    { type: 'resale', product_id: '452', name: 'Premium Гідрогелева плівка на смартфон', price: '300.00', quantity: '1' },
  ], '1791608184877250': [] } };
const [o] = findOrders(resp.data);
const n = normalizeOrder(o);
assert.equal(n.orderId, '1791608184877250');
assert.equal(n.office, '4');
assert.equal(n.date, '2026-10-10 07:56:24');
assert.equal(n.delivery.method, 'Нова Пошта');
assert.equal(n.payment, '');
assert.equal(n.items[0].name, 'Смартфон iHunt Titan Night Hunter');
assert.equal(n.items[0].article, '04979');
assert.equal(n.items[1].article, '');
assert.equal(n.total, 22200);
assert.equal(n.crmTotal, 22200);
console.log('OK — реальна структура розбирається правильно');
