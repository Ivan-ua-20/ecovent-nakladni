// Приводить замовлення LP-CRM до єдиного внутрішнього формату.
// Назви полів LP-CRM можуть відрізнятися між акаунтами, тому беремо перше непорожнє з кількох варіантів.

const pick = (obj, keys) => {
  if (!obj) return '';
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
};

const num = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n) => Math.round(n * 100) / 100;
const textOnly = (v) => (/^\s*\d*\s*$/.test(String(v)) ? '' : String(v));

export function normalizeOrder(raw, productNames = {}) {
  const productsRaw = raw.products || raw.goods || raw.items || [];
  const list = Array.isArray(productsRaw) ? productsRaw : Object.values(productsRaw);

  const items = list.map((p) => {
    const productId = String(pick(p, ['product_id', 'id', 'productId']) || '');
    const qty = num(pick(p, ['quantity', 'count', 'qty', 'amount'])) || 1;
    const price = num(pick(p, ['price', 'cost', 'price_sale']));
    const known = productNames[productId] || {};
    const name =
      pick(p, ['name', 'title', 'product_name', 'product_title']) ||
      known.name ||
      (productId ? `Товар #${productId}` : 'Товар');
    let article = String(pick(p, ['article', 'sku', 'code', 'vendor_code']) || known.article || '');
    let cleanName = String(name);
    // LP-CRM часто тримає артикул у назві: «Смартфон … [04979]»
    const br = cleanName.match(/^(.*\S)\s*\[([^\]]{1,40})\]\s*$/);
    if (br && !article) { cleanName = br[1]; article = br[2]; }
    return {
      productId,
      name: cleanName,
      article,
      unit: 'шт',
      qty,
      price: round2(price),
      sum: round2(qty * price),
    };
  });

  const itemsTotal = round2(items.reduce((s, i) => s + i.sum, 0));
  const discount = num(pick(raw, ['discount', 'sale', 'discount_sum']));
  const deliveryCost = num(pick(raw, ['delivery_price', 'delivery_cost']));
  const crmTotal = num(pick(raw, ['total', 'total_sum', 'sum', 'order_sum']));

  return {
    orderId: String(pick(raw, ['order_id', 'id', 'orderId'])),
    shortId: raw.order_id && raw.id && String(raw.id) !== String(raw.order_id) ? String(raw.id) : '',
    date: String(pick(raw, ['order_time', 'date', 'created_at', 'datetime'])),
    status: String(pick(raw, ['status', 'status_id'])),
    office: String(pick(raw, ['office', 'office_id', 'department'])),
    buyer: {
      name: String(pick(raw, ['bayer_name', 'buyer_name', 'fio', 'name', 'client_name'])),
      phone: String(pick(raw, ['phone', 'buyer_phone', 'tel'])),
      email: String(pick(raw, ['email', 'mail'])),
    },
    delivery: {
      method: textOnly(pick(raw, ['delivery_name', 'delivery'])),
      address: String(pick(raw, ['delivery_adress', 'delivery_address', 'address', 'city'])),
      ttn: String(pick(raw, ['ttn', 'ttn_number', 'declaration'])),
    },
    payment: textOnly(pick(raw, ['payment_name', 'payment'])),
    comment: String(pick(raw, ['comment', 'note'])),
    channel: String(pick(raw, ['additional_1'])).trim(),
    items,
    itemsTotal,
    discount: round2(discount),
    deliveryCost: round2(deliveryCost),
    total: round2(itemsTotal - discount + deliveryCost),
    crmTotal: crmTotal ? round2(crmTotal) : null,
    receiptHint: String(pick(raw, ['receipt_id', 'check_id', 'fiscal_code', 'checkbox_id', 'receipt'])),
  };
}

// Застосовує ручні правки користувача (покупець, товари) поверх даних із CRM.
export function applyEdits(order, edits) {
  if (!edits) return order;
  const o = structuredClone(order);
  if (edits.buyer) o.buyer = { ...o.buyer, ...edits.buyer };
  if (edits.delivery) o.delivery = { ...o.delivery, ...edits.delivery };
  if (edits.payment !== undefined) o.payment = edits.payment;
  if (edits.comment !== undefined) o.comment = edits.comment;
  if (edits.date !== undefined && edits.date !== '') o.invoiceDate = edits.date;
  if (Array.isArray(edits.items)) {
    o.items = edits.items.map((i) => {
      const qty = num(i.qty);
      const price = num(i.price);
      return {
        productId: i.productId || '',
        name: String(i.name || ''),
        article: String(i.article || ''),
        unit: i.unit || 'шт',
        qty,
        price: round2(price),
        sum: round2(qty * price),
      };
    });
  }
  if (edits.discount !== undefined) o.discount = round2(num(edits.discount));
  if (edits.deliveryCost !== undefined) o.deliveryCost = round2(num(edits.deliveryCost));
  o.itemsTotal = round2(o.items.reduce((s, i) => s + i.sum, 0));
  o.total = round2(o.itemsTotal - o.discount + o.deliveryCost);
  o.edited = true;
  return o;
}
