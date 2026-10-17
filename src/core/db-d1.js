// База на Cloudflare D1 з тим самим інтерфейсом, що й локальна (all / get / run).
export function d1Db(D1) {
  const bind = (sql, params) => {
    const st = D1.prepare(sql);
    const p = (params || []).map((v) => (v === undefined ? null : v));
    return p.length ? st.bind(...p) : st;
  };
  return {
    async all(sql, params) {
      return (await bind(sql, params).all()).results || [];
    },
    async get(sql, params) {
      return (await bind(sql, params).first()) || null;
    },
    async run(sql, params) {
      const r = await bind(sql, params).run();
      return { changes: Number(r.meta?.changes || 0), lastId: Number(r.meta?.last_row_id || 0) };
    },
    // Кілька змін одним запитом до D1 (транзакція): [[sql, params], ...]
    async batch(list) {
      for (let i = 0; i < list.length; i += 200) {
        await D1.batch(list.slice(i, i + 200).map(([sql, params]) => bind(sql, params)));
      }
    },
  };
}
