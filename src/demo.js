// Тестове замовлення: працює без підключення до LP-CRM (номер «demo» або «0»).
export const DEMO_ORDER = {
  order_id: 'demo',
  order_time: '2026-10-12 14:35:00',
  status: '11',
  office: '25',
  bayer_name: 'Коваленко Олена Петрівна',
  phone: '380671234567',
  email: 'olena@example.com',
  delivery: 'Нова Пошта',
  delivery_adress: 'м. Київ, Відділення №12, вул. Велика Васильківська, 72',
  ttn: '20450912345678',
  payment: 'Післяплата NovaPay',
  comment: 'Подзвонити перед відправкою',
  products: [
    { product_id: '101', name: 'Рекуператор Ecovent VS-60 Pro', article: 'EV-VS60', price: '6450', count: '1' },
    { product_id: '102', name: 'Зовнішня решітка, біла', article: 'EV-GR100', price: '390', count: '2' },
    { product_id: '103', name: 'Фільтр змінний G3 (комплект 2 шт)', article: 'EV-F-G3', price: '280', count: '1' },
  ],
};
