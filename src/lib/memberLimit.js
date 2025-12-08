const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const dbFile = path.resolve('db/limit.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');

// buat table 1x saja
db.prepare(
  `CREATE TABLE IF NOT EXISTS member_limit (
     user_id   TEXT PRIMARY KEY,
     limit_val TEXT DEFAULT '{}'
   )`
).run();

/* ----------  CRUD  ---------- */
exports.memberLimitSet = (userId, obj) => {
  const val = typeof obj === 'object' ? JSON.stringify(obj) : String(obj);
  db.prepare('INSERT OR REPLACE INTO member_limit (user_id, limit_val) VALUES (?, ?)')
    .run(userId, val);
};

exports.memberLimitGet = (userId) => {
  const row = db.prepare('SELECT limit_val FROM member_limit WHERE user_id = ?').get(userId);
  if (!row) return null;
  try { return JSON.parse(row.limit_val); } catch { return row.limit_val; }
};

exports.memberLimitDel = (userId) => {
  db.prepare('DELETE FROM member_limit WHERE user_id = ?').run(userId);
};