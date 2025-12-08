/**
 * WhiteBot Connection  ✅ v1.3.0-token
 * - auto hapus 401 + QR baru
 * - auth token (login) + owner by-pass
 * - skip channel/broadcast/lid
 * - reconnect & keep-alive
 */
const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const path = require("path");
const fs = require("fs-extra");
const chalk = require("chalk");
const handleCommand = require("./commandHandler");
const { log } = require("./utils");
const stats = require("./lib/stats");
const tokenAuth = require("./lib/tokenAuth");

class Connection {
  constructor({ name, sessionsDir, db, onAuthFail }) {
    this.name = name;
    this.sessionsDir = sessionsDir;
    this.db = db;
    this.sock = null;
    this.onAuthFail = onAuthFail;
    this.reconnectDelay = 3000;
    this.maxReconnect = 10;
    this.attempt = 0;
  }

  async start() {
    const authFolder = path.join(this.sessionsDir, this.name);
    await fs.ensureDir(authFolder);
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    this.sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 30_000,
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        log(chalk.cyan(`📱  QR untuk "${this.name}":`));
        qrcode.generate(qr, { small: true });
      }
      if (connection === "open") {
        this.attempt = 0;
        log(chalk.green(`✅  "${this.name}" berhasil tersambung!`));
      }
      if (connection === "close") {
        const status = lastDisconnect?.error?.output?.statusCode;
        if (status === 401) {
          log(
            chalk.red(
              `❌  "${this.name}" auth gagal (401) – auto-hapus & restart.`
            )
          );
          if (this.onAuthFail) this.onAuthFail(this.name);
          return;
        }
        if (this.attempt >= this.maxReconnect) {
          log(
            chalk.red(
              `⛔  "${this.name}" sudah ${this.attempt}x reconnect – berhenti.`
            )
          );
          return;
        }
        this.attempt++;
        const delay = Math.min(this.reconnectDelay * this.attempt, 30_000);
        log(
          chalk.yellow(
            `🔄  "${this.name}" reconnect ke-${this.attempt} dalam ${delay}ms...`
          )
        );
        setTimeout(() => this.start(), delay);
      }
    });

    this.sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const m of messages) {
        try {
          if (!m.message) continue;

          const jid = m.key.remoteJid;
          const fromMe = m.key.fromMe;
          const text =
            m.message.conversation || m.message.extendedTextMessage?.text || "";

          /* 1. LOG */
          console.log(chalk.yellow(`[RAW] ${jid} | me:${fromMe} | "${text}"`));

          /* 2. STATS */
          if (!fromMe) {
            stats.hitMsg();
            stats.addUser(jid);
            this.db.addUser(jid);
          }

          /* 3. FILTER – hanya merespon jika:
         - chat pribadi, atau
         - di grup tapi pakai prefix "." atau di-mention bot
      */
          const isGroup = jid.endsWith("@g.us");
          const botNumber =
            this.sock.user.id.replace(/:.+/, "") + "@s.whatsapp.net"; // normalize
          const isMentioned =
            m.message.extendedTextMessage?.contextInfo?.mentionedJid?.includes(
              botNumber
            ) || false;
          const startsWithPrefix = text.startsWith(".");

          if (isGroup && !startsWithPrefix && !isMentioned) continue;

          /* 4. LANJUT KE COMMAND HANDLER */
          await handleCommand({
            connection: this,
            message: m,
            jid,
            text,
            fromMe,
            db: this.db,
          });
        } catch (err) {
          console.error(chalk.red("[MESSAGE HANDLER ERROR]"), err);
        }
      }
    });

    /* tetap sama */
    process.on("uncaughtException", (err) => log("Uncaught: " + err));
    process.on("unhandledRejection", (err) => log("Unhandled: " + err));
  }
  /* ---------- 4. WRAPPER KIRIM PESAN ---------- */
  async sendMessage(jid, message) {
    if (!this.sock) throw new Error("Socket belum ready");
    return await this.sock.sendMessage(jid, message);
  }

  /* ---------- 5. GRACEFUL CLOSE ---------- */
  close() {
    if (this.sock) this.sock.end();
  }
}

module.exports = Connection;
