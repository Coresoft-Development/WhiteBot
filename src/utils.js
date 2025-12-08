/**
 * WhiteBot Utils  ✅ v1.2.0  |  MAX-UPDATE
 * - pastikan folder logs selalu ada
 * - rotasi harian (opsional) & console warna
 * - thread-safe append (sync)
 */
const fs = require("fs-extra");
const path = require("path");
const chalk = require("chalk");

/* ---------- 1. PASTIKAN FOLDER ADA ---------- */
fs.ensureDirSync(process.env.LOG_DIR || "./logs");

/* ---------- 2. NAMA FILE ROTASI HARIAN ---------- */
const fileName = () => new Date().toISOString().slice(0, 10) + ".log";

/* ---------- 3. LOGGER MAXIMAL ---------- */
const log = (msg) => {
  const now = new Date();
  const time = now.toISOString();
  const line = `[${time}] ${msg}\n`;

  // 3a. console dengan warna
  console.log(chalk.gray(`[${now.toLocaleTimeString("id-ID")}]`) + ` ${msg}`);

  // 3b. append ke file harian
  const logFile = path.join(process.env.LOG_DIR, fileName());
  try {
    fs.appendFileSync(logFile, line);
  } catch (e) {
    // kalau gagal, coba bikit file baru
    fs.writeFileSync(logFile, line, { flag: "a" });
  }
};

/* ---------- 4. EXPORT + UTIL TAMBAHAN ---------- */
module.exports = { log };
