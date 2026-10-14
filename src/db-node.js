// Локальна база: вбудований SQLite у Node.js.
// Той самий асинхронний інтерфейс буде реалізовано поверх Cloudflare D1.
import { DatabaseSync } from 'node:sqlite';

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  const norm = (params) => (params || []).map((v) => (v === undefined ? null : v));
  return {
    async all(sql, params) {
      return db.prepare(sql).all(...norm(params));
    },
    async get(sql, params) {
      return db.prepare(sql).get(...norm(params)) || null;
    },
    async run(sql, params) {
      const r = db.prepare(sql).run(...norm(params));
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
  };
}
