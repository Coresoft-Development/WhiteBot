/**
 * WhiteBot General Commands  ✅ v1.3.7-fix
 * tetap 1 file, aman di Baileys terbaru
 */
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const stats = require("../lib/stats");

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/* ---------- helper ---------- */
const fmtBytes = (b) => {
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(2)} ${u[i]}`;
};
const upTime = (s) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
};

module.exports = {
  menu: async (ctx) => {
    /* ⬇️ semua destructuring DALAM function */
    const { connection, jid, db, sender } = ctx;
    const userName = (sender || "").split("@")[0] || "user";

    console.log(`[LOG-MENU] db: ${typeof db}, jid: ${jid}`);

    const stat = stats.todayStats();
    const total = stats.countUsers();

    const text = `Hai @${userName} 👋, *${process.env.BOT_NAME}* siap membantu!
📊 *Hari ini*
├ Pesan hari ini: ${stat.msg_today}
├ User baru hari ini: ${stat.user_today}
├ Total user aktif: ${total}
├ RAM: ${fmtBytes(process.memoryUsage().rss)}
└ Uptime: ${upTime(process.uptime())}

💡 _Ketik dan kirim command di bawah untuk mencoba fitur WhiteBot_`;

    fs.ensureDirSync(path.join(__dirname, "../../media"));

    try {
      await connection.sendMessage(jid, {
        text,
        mentions: [sender],
        footer: "WhiteBot v1.3.7-fix",
        buttons: [
          {
            buttonId: ".ping",
            buttonText: { displayText: "🏓 Ping!" },
            type: 1,
          },
          {
            buttonId: ".about",
            buttonText: { displayText: "ℹ️ About" },
            type: 1,
          },
          {
            buttonId: ".owner",
            buttonText: { displayText: "🌐 Sewa Bot" },
            type: 1,
          },
        ],
        headerType: 1,
      });
      console.log(`[LOG-MENU] Native button terkirim ke ${jid}`);
    } catch (e) {
      console.log(`[LOG-MENU] Button gagal, fallback text → ${e.message}`);
      await connection.sendMessage(jid, {
        text:
          text +
          "\n\n*Command:*\n.menu  • ini\n.ping  • kecepatan\n.about • info",
      });
    }
  },

  ping: async (ctx) => {
    const { connection, jid } = ctx;
    const t0 = Date.now();
    const msg = await connection.sendMessage(jid, {
      text: "⏱️ _Checking speed..._",
    });
    const latency = Date.now() - t0;
    const info = `
*Pong!* ⚡
├ Latency : ${latency} ms
└ Server  : ${process.env.BOT_NAME || "WhiteBot"}
    `.trim();
    await connection.sendMessage(jid, { text: info }, { quoted: msg });
  },

  about: async (ctx) => {
    const { connection, jid } = ctx;
    const thumbPath = path.join(__dirname, "../../media/logo.jpg");
    let thumb;
    try {
      thumb = fs.readFileSync(thumbPath);
    } catch {
      thumb = null;
    }

    const text = `
*${process.env.BOT_NAME}* – WhatsApp Bot
├ Version : 1.3.7-fix
├ Runtime : Node.js ${process.version}
├ Owner   : wa.me/${process.env.OWNER_NUMBER}
├ Library : @whiskeysockets/baileys
└ Support : 24/7 auto-reconnect
    `.trim();

    try {
      await connection.sendMessage(jid, { image: thumb, caption: text });
    } catch (e) {
      await connection.sendMessage(jid, { text });
    }
  },
};
