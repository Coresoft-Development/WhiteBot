/**
 * WhiteBot SessionManager  ✅ v1.2.0  |  MAX-UPDATE
 * - otomatis create / reload unlimited session
 * - auto hapus session yg error 401 dari disk
 * - support multiple parallel session
 * - logger detail + warna
 */
const fs   = require('fs-extra');
const path = require('path');
const chalk= require('chalk');          // warna di console
const Connection = require('./connection');

class SessionManager {
  constructor({ sessionsDir, db }) {
    this.sessionsDir = sessionsDir;
    this.db = db;
    this.sessions = new Map();          // name → Connection instance

    // langsung start saat instan
    this.init();
  }

  /* ----------------------------------------------------------
   * 1. INIT: scan folder & buat default kalau kosong
   * ---------------------------------------------------------- */
  async init() {
    await this.scanAndStartAll();
    if (this.sessions.size === 0) await this.createSession('default');
  }

  /* ----------------------------------------------------------
   * 2. SCAN SEMUA FOLDER → START CONNECTION
   * ---------------------------------------------------------- */
  async scanAndStartAll() {
    const dirs = fs.readdirSync(this.sessionsDir)
                   .filter(f => fs.statSync(path.join(this.sessionsDir, f)).isDirectory());

    if (!dirs.length) {
      console.log(chalk.yellow('🟡  Belum ada session di disk.'));
      return;
    }

    console.log(chalk.cyan(`📂  Ditemukan ${dirs.length} session, sedang menyambung...`));
    for (const d of dirs) await this.createSession(d);
  }

  /* ----------------------------------------------------------
   * 3. BUAT SESSION BARU (bisa dipanggil dari luar)
   * ---------------------------------------------------------- */
  async createSession(name) {
    if (this.sessions.has(name)) {
      console.log(chalk.gray(`➡️  Session "${name}" sudah aktif.`));
      return;
    }
    console.log(chalk.green(`🔌  Membuat session "${name}"...`));
    const conn = new Connection({
      name,
      sessionsDir: this.sessionsDir,
      db: this.db,
      onAuthFail: () => this.handleAuthFail(name)   // callback 401
    });
    this.sessions.set(name, conn);
    await conn.start();
  }

  /* ----------------------------------------------------------
   * 4. HAPUS SESSION + FOLDER (saat 401 / owner minta delete)
   * ---------------------------------------------------------- */
  async deleteSession(name) {
    if (!this.sessions.has(name)) return;
    console.log(chalk.red(`🗑️  Menghapus session "${name}"...`));
    const conn = this.sessions.get(name);
    if (conn.sock) conn.sock.end();          // graceful close
    this.sessions.delete(name);

    // hapus folder auth
    const folder = path.join(this.sessionsDir, name);
    await fs.remove(folder).catch(() => {});
  }

  handleAuthFail(name) {
    console.log(chalk.red(`❌  Auth 401 pada "${name}" -> auto-delete & restart.`));
    this.deleteSession(name).then(() => this.createSession(name));
  }

  /* ----------------------------------------------------------
   * 5. UTILITAS OWNER (opsional untuk sewa)
   * ---------------------------------------------------------- */
  list() { return [...this.sessions.keys()]; }
  isOnline(name) { return this.sessions.has(name); }
  size() { return this.sessions.size; }
}

module.exports = SessionManager;