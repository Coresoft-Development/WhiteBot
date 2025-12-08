/**
 * WhiteBot Database  ✅ v1.2.2  |  TERBARU & TERUPDATE
 * - otomatis migrasi kolom baru (phone, join_date) TANPA hapus file
 * - WAL-mode performa tinggi
 * - helper lengkap untuk sewa
 */
const Database = require("better-sqlite3");
const fs = require("fs-extra");
const path = require("path");

class DB {
  constructor(dbPath) {
    this.dbPath = dbPath;
    fs.ensureDirSync(path.dirname(dbPath));

    // buka DB + performa mode
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    /* 1. BANGUN TABEL DULU ⬇️ */
    this.init();

    /* 2. BARU MIGRASI ⬇️ */
    const hasPhone = this.db
      .prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='phone'")
      .get();
    const hasJoinDate = this.db
      .prepare(
        "SELECT 1 FROM pragma_table_info('users') WHERE name='join_date'"
      )
      .get();
    if (!hasPhone) this.db.exec(`ALTER TABLE users ADD COLUMN phone TEXT;`);
    if (!hasJoinDate)
      this.db.exec(
        `ALTER TABLE users ADD COLUMN join_date INTEGER DEFAULT (strftime('%s','now'));`
      );
  }

  /* ----------------------------------------------------------
   * 1. SKEMA + INDEKS
   * ---------------------------------------------------------- */
  init() {
    const schema = [
      `CREATE TABLE IF NOT EXISTS users (
         jid TEXT PRIMARY KEY,
         name TEXT,
         phone TEXT,
         join_date INTEGER DEFAULT (strftime('%s','now'))
       );`,
      `CREATE INDEX IF NOT EXISTS idx_users_date ON users(join_date);`,

      `CREATE TABLE IF NOT EXISTS messages (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         jid TEXT,
         from_me INTEGER,
         body TEXT,
         created_at INTEGER DEFAULT (strftime('%s','now'))
       );`,
      `CREATE INDEX IF NOT EXISTS idx_msg_date ON messages(created_at);`,

      `CREATE TABLE IF NOT EXISTS broadcast_log (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         sent_by TEXT,
         body TEXT,
         recipients INTEGER,
         sent_at INTEGER DEFAULT (strftime('%s','now'))
       );`,
    ];
    schema.forEach((s) => this.db.exec(s));
  }

  /* ----------------------------------------------------------
   * 2. USER HELPERS
   * ---------------------------------------------------------- */
  addUser(jid, name = "", phone = "") {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO users (jid, name, phone) VALUES (?,?,?)`
    );
    stmt.run(jid, name, phone);
  }

  getUser(jid) {
    return this.db.prepare("SELECT * FROM users WHERE jid = ?").get(jid);
  }

  getAllUsers() {
    return this.db
      .prepare("SELECT jid, name FROM users ORDER BY join_date DESC")
      .all();
  }

  countUsers() {
    return this.db.prepare("SELECT COUNT(*) as total FROM users").get().total;
  }

  /* ----------------------------------------------------------
   * 3. MESSAGE HELPERS
   * ---------------------------------------------------------- */
  saveMessage(jid, fromMe, body) {
    const stmt = this.db.prepare(
      `INSERT INTO messages (jid, from_me, body) VALUES (?,?,?)`
    );
    stmt.run(jid, fromMe ? 1 : 0, body);
  }

  countMessages(jid) {
    return this.db
      .prepare("SELECT COUNT(*) as total FROM messages WHERE jid = ?")
      .get(jid).total;
  }

  todayStats() {
    const today = new Date().toISOString().slice(0, 10) + "%";
    return this.db
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM messages WHERE created_at LIKE ?) as msg_today,
        (SELECT COUNT(*) FROM users WHERE join_date LIKE ?) as user_today
    `
      )
      .get(today, today);
  }

  /* ----------------------------------------------------------
   * 4. BROADCAST LOGGER
   * ---------------------------------------------------------- */
  logBroadcast(sender, body, recipients) {
    this.db
      .prepare(
        `INSERT INTO broadcast_log (sent_by, body, recipients) VALUES (?,?,?)`
      )
      .run(sender, body, recipients);
  }

  /* ----------------------------------------------------------
   * 5. BACKUP FILE (opsional, panggil 1×/minggu)
   * ---------------------------------------------------------- */
  backupTo(fileName = `${this.dbPath}.bak`) {
    this.db
      .backup(fileName)
      .run(() => console.log("✅ Backup selesai:", fileName));
  }

  /* ----------------------------------------------------------
   * 6. GRACEFUL CLOSE
   * ---------------------------------------------------------- */
  close() {
    this.db.close();
  }
}

module.exports = DB;
