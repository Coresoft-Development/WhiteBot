/**
 * WhiteBot Connection  ✅ v1.2.0  |  MAX-UPDATE
 * - auto hapus folder 401 + QR baru tanpa sentuh
 * - keep-alive + reconnect exponential back-off
 * - logger detail + warna
 * - support callback onAuthFail untuk SessionManager
 */
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const handleCommand = require('./commandHandler');
const { log } = require('./utils');
const stats = require('./lib/stats');

class Connection {
  constructor({ name, sessionsDir, db, onAuthFail }) {
    this.name = name;
    this.sessionsDir = sessionsDir;
    this.db = db;
    this.sock = null;
    this.onAuthFail = onAuthFail;   // callback ke SessionManager
    this.reconnectDelay = 3000;     // back-off awal
    this.maxReconnect = 10;         // limit agar tidak infinite
    this.attempt = 0;               // counter reconnect
  }

  /* ----------------------------------------------------------
   * 1. START / RESTART
   * ---------------------------------------------------------- */
  async start() {
    const authFolder = path.join(this.sessionsDir, this.name);
    await fs.ensureDir(authFolder);

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    this.sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      // optional: agar reconnect lebih cepat
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 30_000
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        log(chalk.cyan(`📱  QR untuk "${this.name}":`));
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        this.attempt = 0; // reset counter
        log(chalk.green(`✅  "${this.name}" berhasil tersambung!`));
      }

      if (connection === 'close') {
        const status = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = status !== 401;

        if (status === 401) {
          log(chalk.red(`❌  "${this.name}" auth gagal (401) – auto-hapus & restart.`));
          if (this.onAuthFail) this.onAuthFail(this.name);
          return; // stop, sudah di-handle dari luar
        }

        if (this.attempt >= this.maxReconnect) {
          log(chalk.red(`⛔  "${this.name}" sudah ${this.attempt}x reconnect – berhenti.`));
          return;
        }

        this.attempt++;
        const delay = Math.min(this.reconnectDelay * this.attempt, 30_000); // max 30 detik
        log(chalk.yellow(`🔄  "${this.name}" reconnect ke-${this.attempt} dalam ${delay}ms...`));
        setTimeout(() => this.start(), delay);
      }
    });

    /* ------------------------------------------------------
     * 2. MESSAGE HANDLER
     * ------------------------------------------------------ */
       this.sock.ev.on('messages.upsert', async ({ messages }) => {
     for (const m of messages) {
       if (!m.message) continue;

       const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
       const jid  = m.key.remoteJid;
       const fromMe = m.key.fromMe;

       /* ⬅️ counter statistik */
       if (!fromMe) {
         stats.hitMsg();
         stats.addUser(jid);
       }

       // auto-register user baru (kode lama kamu)
       if (!fromMe) this.db.addUser(jid);

       console.log(chalk.gray(`[MSG] ${jid} | me:${fromMe} | "${text}"`));
       this.db.saveMessage(jid, fromMe ? 1 : 0, text);

       await handleCommand({ connection: this, message: m, jid, text, fromMe, db: this.db });
     }
   });

    /* ------------------------------------------------------
     * 3. ERROR GLOBAL (agar Node tidak exit)
     * ------------------------------------------------------ */
    process.on('uncaughtException', err => log('Uncaught: ' + err));
    process.on('unhandledRejection', err => log('Unhandled: ' + err));
  }

  /* ----------------------------------------------------------
   * 4. KIRIM PESAN (wrapper agar konsisten)
   * ---------------------------------------------------------- */
  async sendMessage(jid, message) {
    if (!this.sock) throw new Error('Socket belum ready');
    return await this.sock.sendMessage(jid, message);
  }

  /* ----------------------------------------------------------
   * 5. GRACEFUL CLOSE (dipanggil saat delete session)
   * ---------------------------------------------------------- */
  close() {
    if (this.sock) this.sock.end();
  }
}

module.exports = Connection;