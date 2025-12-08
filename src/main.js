/**
 * WhiteBot Entry-Point  ✅ v1.2.0  |  MAX-UPDATE
 * - otomatis buat folder & file yang hilang
 * - otomatis hapus session 401 & bikin ulang
 * - otomatis start tanpa sentuh kode lagi
 * - tambahan info start-up lengkap
 */
require("dotenv").config();
const fs = require("fs-extra");
const path = require("path");
const chalk = require("chalk"); // warna-warni (opsional)
const SessionManager = require("./sessionManager");
const DB = require("./db");
const { log } = require("./utils");

/* ---------- 1. PASTIKAN SEMUA FOLDER ADA ---------- */
const MUST_HAVE = [
  process.env.SESSIONS_DIR || "./sessions",
  process.env.LOG_DIR || "./logs",
  "media", // untuk menyimpan file user
];
MUST_HAVE.forEach((d) => fs.ensureDirSync(d));

/* ---------- 2. PASTIKAN .env SUDAH TERISI ---------- */
if (!process.env.OWNER_NUMBER || !process.env.BOT_NAME) {
  log("❗  OWNER_NUMBER & BOT_NAME wajib diisi di .env");
  process.exit(1);
}

/* ---------- 3. INISIASI DB + SESSION MANAGER ---------- */
const db = new DB(process.env.DB_PATH || "./db/whitebot.db");
new SessionManager({ sessionsDir: process.env.SESSIONS_DIR, db });

/* ---------- 4. LOG INDOOR + OUTDOOR ---------- */
log("🚀 Starting WhiteBot...");
log(`📂 Sessions : ${path.resolve(process.env.SESSIONS_DIR)}`);
log(`📀 Database : ${path.resolve(process.env.DB_PATH)}`);
log(`👤 Owner    : ${process.env.OWNER_NUMBER}`);
log(`🤖 Bot Name : ${process.env.BOT_NAME}`);
log("");

/* ---------- 5. TIPS SEWA (tampil sekali) ---------- */
console.log(
  chalk.cyanBright(`💡  Tips sewa:
   • Kirim .menu untuk melihat menu
   • Owner kirim .broadcast <teks> untuk blast
   • Auto-reconnect & auto-delete session expired
   • Biarkan terminal tetap berjalan 24/7\n`)
);
