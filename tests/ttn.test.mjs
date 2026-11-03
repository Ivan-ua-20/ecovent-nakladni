// ТТН із замовлення LP-CRM — усіх служб доставки (для перевірки дублів ТТН і пошуку замовлень за ТТН).
import assert from 'node:assert/strict';
import { ttnOf } from '../src/modules/analytics/index.js';

const ok = {
  'Нова пошта': ['20450000001111', '20 4500 0000 1111'],
  'ROZETKA Delivery': ['RMP-1000000001', 'rmp-1000000001'],
  'ROZETKA Delivery через Prom': ['PRM-1234567890'],
  'Укрпошта': ['0503812345678'],
  'Meest': ['MYCV123456789UA'],
};
for (const [svc, list] of Object.entries(ok)) for (const v of list) assert.notEqual(ttnOf({ ttn: v }), '', `${svc}: ${v}`);
assert.equal(ttnOf({ ttn: 'rmp-1000000001' }), 'RMP-1000000001', 'великими літерами, з дефісом');
assert.equal(ttnOf({ ttn: '20 4500 0000 1111' }), '20450000001111', 'без пробілів');
assert.equal(ttnOf({ declaration: 'RMP-1000000002' }), 'RMP-1000000002', 'інше поле');
for (const v of ['', '0000000000', 'RMP-ABCDEFG', 'самовивіз', '12-34', '-RMP1000000', 'RMP1000000-', 'ABCDEFGHIJ12']) assert.equal(ttnOf({ ttn: v }), '', `не ТТН: «${v}»`);
console.log('OK — ТТН усіх служб доставки (Нова пошта, ROZETKA Delivery, Prom, Укрпошта, Meest)');
