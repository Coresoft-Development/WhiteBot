/*  WhiteBot General Commands  ✅ v1.3.8-token  (FIXED)o
 *  - gettoken & login
 *  - HD, sticker, tiktok, tomp3
 *  - stats, menu, ping, about
 *  ----------------------------------------  */
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const axios = require("axios"); // ⬅️ baru
const ffmpeg = require("fluent-ffmpeg"); // ⬅️ baru
const sharp = require("sharp"); // ⬅️ baru
const { createSticker, StickerTypes } = require("wa-sticker-formatter"); // ⬅️ baru
const stats = require("../lib/stats");
const tokenAuth = require("../lib/tokenAuth"); // <─ pastikan ada
const ownerAuth = require("../lib/ownerAuth"); // <─ baru
const { realNumber } = require("../lib/numberHelper");

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/* ---------- fitur baru ---------- */
const autoReplyDB = new Map(); // keyword : jawaban
const floodMap = new Map(); // jid : {count, lastTime}
const PROMOTE_COOLDOWN = 5000; // ms
const FLOOD_LIMIT = 5; // pesan
const FLOOD_WINDOW = 10000; // 10 detik

/* ---------- helper lama ---------- */
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

// /* ---------- SISTEM LOGIN WAJIB ---------- */
// const ownerSession = new Set();          // owner yang sudah login 
// const userLoginMap = new Map();          // token → userJid (1 token 1 user)
// const userSession = new Set();           // userJid yang sudah login
// const autoReplyPerUser = new Map();      // opsional: userJid → Map(keyword→answer)

const {
  ownerSession,
  userLoginMap,
  userSession,
  autoReplyPerUser,
} = require("../lib/sessionStore");

/* ==========  COMMAND ========== */
/* ---------- HELPER DAFTAR COMMAND PER ROLE ---------- */

function listCommands(isOwner = false) {
  const all = Object.keys(module.exports);
  const ownerOnly = [
    "ownerlogin",
    "ownerlogout",
    "gettoken",
    "revoke",
    "broadcast",
    "status",
    "adduser",
    "deluser",
  ];
  const userCmd = all.filter(
    (c) => !ownerOnly.includes(c) && !["help", "antispam"].includes(c)
  );
  return isOwner
    ? all.filter((c) => !["help", "antispam"].includes(c))
    : userCmd;
}

module.exports = {
  /* ---------- OWNER ---------- */
  /* Owner login – wajib sebelum .gettoken */
  ownerlogin: async (ctx) => {
    const { connection, jid, text } = ctx;
    const [email, pass] = text.trim().split(" ").slice(1);
    if (!email || !pass)
      return await connection.sendMessage(jid, {
        text: "❗ Contoh: .ownerlogin ryuudev.new@gmail.com 12345678",
      });
    if (ownerAuth.login(email, pass)) {
      ownerSession.add(jid);
      await connection.sendMessage(jid, {
        text: "✅ Owner login berhasil!\nSekarang kamu bisa pakai *.gettoken* untuk buat token user.",
      });
    } else {
      await connection.sendMessage(jid, { text: "❌ Email / password salah." });
    }
  },

  ownerlogout: async (ctx) => {
    const { connection, jid } = ctx;
    ownerAuth.logout();
    ownerSession.delete(jid);
    await connection.sendMessage(jid, { text: "✅ Owner logout berhasil." });
  },

  gettoken: async (ctx) => {
  const { connection, jid } = ctx;
  if (!ownerSession.has(jid))
    return await connection.sendMessage(jid, { text: '❗ Owner harus login dulu!' });

  const t = tokenAuth.create();
  tokenAuth.set(t, 'FREE');   // ← FREE = bisa dipakai siapa saja
  await connection.sendMessage(jid, { text: `✅ Token baru: ${t}\nKirim ke user yang ingin pakai bot.` });
},

  revoke: async (ctx) => {
  const { connection, jid, text } = ctx;
  if (!ownerSession.has(jid)) return await connection.sendMessage(jid, { text: '❗ Owner harus login dulu!' });
  const token = text.trim().split(' ')[1];
  if (!token) return await connection.sendMessage(jid, { text: '❗ Gunakan: .revoke ABCD1234' });

  const val = tokenAuth.get(token);
  if (!val) return await connection.sendMessage(jid, { text: '❓ Token tidak ditemukan.' });

  // kalau token sedang dipakai user, kick user
  if (val !== 'FREE' && val !== 'REVOKED') {
    userSession.delete(val);
    userLoginMap.delete(token);
  }

  tokenAuth.set(token, 'REVOKED');
  await connection.sendMessage(jid, { text: `✅ Token *${token}* dicabut & user otomatis logout.` });
},

  login: async (ctx) => {
  const { connection, jid, text, m } = ctx;
  const realJid = realNumber(jid, m?.key?.participant);

  const args = text.trim().split(/\s+/);
  const token = args[1];
  if (!token) return await connection.sendMessage(jid, { text: '❗ Gunakan: .login <token>' });

  const val = tokenAuth.get(token);
  if (!val) return await connection.sendMessage(jid, { text: '❌ Token tidak ditemukan.' });
  if (val === 'REVOKED') {
    tokenAuth.del(token);
    return await connection.sendMessage(jid, { text: '❌ Token telah dicabut.' });
  }
  if (val !== 'FREE')  // ← bukan FREE = sudah dipakai
    return await connection.sendMessage(jid, { text: '❌ Token sudah dipakai user lain.' });

  // tukar FREE → jid user
  tokenAuth.set(token, realJid);
  userLoginMap.set(token, realJid);
  userSession.add(realJid);

  await connection.sendMessage(jid, { text: '✅ Login berhasil! Sekarang kamu bisa pakai semua fitur bot.' });
},

  menu: async (ctx) => {
    const { connection, jid, db, sender } = ctx;

    const realJid = realNumber(jid, ctx.m?.key?.participant);
    if (!userSession.has(realJid) && !ownerSession.has(realJid)) {
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login!\nUser → .login <token>\nOwner → .ownerlogin",
      });
    }

    const userName = (realJid || "").split("@")[0] || "user";
    const stat = stats.todayStats();
    const total = stats.countUsers();
    const ram = fmtBytes(process.memoryUsage().rss);
    const uptime = upTime(process.uptime());

    const waktuSrv = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
    });

    const text = `Hai @${userName} 👋, *${process.env.BOT_NAME}* siap membantu!

📊 *Statistik Hari Ini*
├ Pesan: ${stat.msg_today}
├ User baru: ${stat.user_today}
├ Total aktif: ${total}
├ RAM: ${ram}
├ Uptime: ${uptime}
└ Waktu server: ${waktuSrv}

💡 *Command*
├ .help     – lihat daftar lengkap
├ .ping     – cek kecepatan bot
└ .about    – info versi & owner

Ketik command di diatas untuk mencoba fitur WhiteBot.`;

    try {
      await connection.sendMessage(jid, {
        text,
        mentions: [realJid],
        footer: "WhiteBot v1.0.0-RELEASE",
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
    } catch (e) {
      // Fallback untuk client yang tidak support button
      const isOwner = ownerSession.has(realJid);
      const cmdList = listCommands(isOwner).join("  •  ");
      await connection.sendMessage(jid, {
        text: `${text}\n\n*Command:*\n${cmdList}\n\nKetik *.help* untuk detail.`,
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
    await connection.sendMessage(
      jid,
      {
        text: `*Pong!* ⚡\n├ Latency : ${latency} ms\n└ Server  : ${
          process.env.BOT_NAME || "WhiteBot"
        }`,
      },
      { quoted: msg }
    );
  },

  about: async (ctx) => {
    const { connection, jid } = ctx;
    const thumbPath = path.join(__dirname, "../../media/WhiteBot.jpg");
    let thumb;
    try {
      thumb = fs.readFileSync(thumbPath);
    } catch {
      thumb = null;
    }
    const text = `*${process.env.BOT_NAME}* – WhatsApp Bot
├ Version : 1.6.1-RELEASE
├ Runtime : Node.js ${process.version}
├ Owner   : wa.me/${process.env.OWNER_NUMBER}
├ Library : @whiskeysockets/baileys
└ Support : 24/7 auto-reconnect`;
    await connection.sendMessage(jid, { image: thumb, caption: text });
  },

  calc: async (ctx) => {
    const { connection, jid, text } = ctx;
    const expr = text.trim().slice(5).trim();
    if (!expr)
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .calc <ekspresi>\nContoh: .calc 2*(3+4)^2",
      });
    try {
      const result = Function(
        '"use strict"; return (' + expr.replace(/[^0-9+\-*/().^√]/g, "") + ")"
      )();
      await connection.sendMessage(
        jid,
        { text: `🔍 *Soal:* ${expr}\n✅ *Jawaban:* ${result}` },
        { quoted: ctx.m }
      );
    } catch (e) {
      await connection.sendMessage(
        jid,
        {
          text: "❌ Ekspresi tidak valid.\nGunakan angka & operator + - * / ^ √ ( ) saja.",
        },
        { quoted: ctx.m }
      );
    }
  },

  addreply: async (ctx) => {
    const { connection, jid, text } = ctx;
    if (!text.includes("|"))
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .addreply keyword|jawaban",
      });
    const [kw, ...ansArr] = text.slice(10).split("|");
    const answer = ansArr.join("|").trim();
    if (!kw || !answer)
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .addreply halo|Halo juga!",
      });
    autoReplyDB.set(kw.trim().toLowerCase(), answer);
    await connection.sendMessage(
      jid,
      {
        text: `✅ Auto reply ditambah:\nKeyword: *${kw.trim()}*\nJawaban: *${answer}*`,
      },
      { quoted: ctx.m }
    );
  },

  delreply: async (ctx) => {
    const { connection, jid, text } = ctx;
    const kw = text.slice(10).trim().toLowerCase();
    if (!kw)
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .delreply keyword",
      });
    if (autoReplyDB.delete(kw)) {
      await connection.sendMessage(
        jid,
        { text: `✅ Keyword *${kw}* dihapus.` },
        { quoted: ctx.m }
      );
    } else {
      await connection.sendMessage(
        jid,
        { text: `❓ Keyword *${kw}* tidak ditemukan.` },
        { quoted: ctx.m }
      );
    }
  },

  myreplyadd: async (ctx) => {
    const { connection, jid, text, sender } = ctx;
    if (!userSession.has(sender))
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login!",
      });
    if (!text.includes("|"))
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .myreplyadd keyword|jawaban",
      });
    const [kw, ...ansArr] = text.slice(13).split("|");
    const answer = ansArr.join("|").trim();
    if (!kw || !answer)
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .myreplyadd halo|Halo pribadi!",
      });
    let map = autoReplyPerUser.get(sender);
    if (!map) {
      map = new Map();
      autoReplyPerUser.set(sender, map);
    }
    map.set(kw.trim().toLowerCase(), answer);
    await connection.sendMessage(
      jid,
      {
        text: `✅ Auto reply pribadi ditambah:\nKeyword: *${kw.trim()}*\nJawaban: *${answer}*`,
      },
      { quoted: ctx.m }
    );
  },

  myreplydel: async (ctx) => {
    const { connection, jid, text, sender } = ctx;
    if (!userSession.has(sender))
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login!",
      });
    const kw = text.slice(15).trim().toLowerCase();
    if (!kw)
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .myreplydel keyword",
      });
    const map = autoReplyPerUser.get(sender);
    if (map && map.delete(kw)) {
      await connection.sendMessage(
        jid,
        { text: `✅ Keyword pribadi *${kw}* dihapus.` },
        { quoted: ctx.m }
      );
    } else {
      await connection.sendMessage(
        jid,
        { text: `❓ Keyword pribadi *${kw}* tidak ditemukan.` },
        { quoted: ctx.m }
      );
    }
  },

  promote: async (ctx) => {
    const { connection, jid, text, m } = ctx;
    if (!ownerSession.has(jid))
      return await connection.sendMessage(jid, {
        text: "❗ Owner harus login dulu!",
      });
    const num = text.trim().split(" ")[1];
    if (!num)
      return await connection.sendMessage(
        jid,
        { text: "❗ Gunakan: .promote @tag / nomor" },
        { quoted: m }
      );
    const target = num.replace(/[^\d]/g, "") + "@s.whatsapp.net";
    await connection.groupParticipantsUpdate(jid, [target], "promote");
    await connection.sendMessage(
      jid,
      {
        text: `✅ @${target.split("@")[0]} menjadi admin.`,
        mentions: [target],
      },
      { quoted: m }
    );
  },

  demote: async (ctx) => {
    const { connection, jid, text, m } = ctx;
    if (!ownerSession.has(jid))
      return await connection.sendMessage(jid, {
        text: "❗ Owner harus login dulu!",
      });
    const num = text.trim().split(" ")[1];
    if (!num)
      return await connection.sendMessage(
        jid,
        { text: "❗ Gunakan: .demote @tag / nomor" },
        { quoted: m }
      );
    const target = num.replace(/[^\d]/g, "") + "@s.whatsapp.net";
    await connection.groupParticipantsUpdate(jid, [target], "demote");
    await connection.sendMessage(
      jid,
      {
        text: `✅ @${target.split("@")[0]} diturunkan dari admin.`,
        mentions: [target],
      },
      { quoted: m }
    );
  },

  tagall: async (ctx) => {
    const { connection, jid, m, text } = ctx;
    if (!userSession.has(jid) && !ownerSession.has(jid))
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login!",
      });
    const groupMetadata = await connection.groupMetadata(jid);
    const participants = groupMetadata.participants.map((p) => p.id);
    const pesan = text.slice(8).trim() || "Halo semua! 📢";
    const mentions = participants;
    await connection.sendMessage(
      jid,
      { text: `${pesan}`, mentions },
      { quoted: m }
    );
  },

  tomp3: async (ctx) => {
    const { connection, jid, m, downloadMediaMessage } = ctx;
    if (!userSession.has(jid) && !ownerSession.has(jid))
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login!",
      });
    const msg = m.message.videoMessage || m.message.documentMessage;
    if (!msg)
      return await connection.sendMessage(
        jid,
        { text: "❗ Balas video yang ingin dijadikan mp3!" },
        { quoted: m }
      );
    const media = await downloadMediaMessage(m);
    const tmpIn = path.join(os.tmpdir(), "v_" + Date.now() + ".mp4");
    const tmpOut = path.join(os.tmpdir(), "a_" + Date.now() + ".mp3");
    fs.writeFileSync(tmpIn, media);
    await new Promise((res, rej) =>
      ffmpeg(tmpIn)
        .output(tmpOut)
        .audioBitrate(128)
        .format("mp3")
        .on("end", res)
        .on("error", rej)
        .run()
    );
    await connection.sendMessage(
      jid,
      { audio: fs.readFileSync(tmpOut), mimetype: "audio/mp4" },
      { quoted: m }
    );
    fs.unlinkSync(tmpIn);
    fs.unlinkSync(tmpOut);
  },

  sticker2img: async (ctx) => {
    const { connection, jid, m, downloadMediaMessage } = ctx;
    if (!userSession.has(jid) && !ownerSession.has(jid))
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login!",
      });
    if (!m.message.stickerMessage)
      return await connection.sendMessage(
        jid,
        { text: "❗ Balas stiker yang ingin dijadikan foto!" },
        { quoted: m }
      );
    const media = await downloadMediaMessage(m);
    await connection.sendMessage(
      jid,
      { image: media, caption: "✅ Stiker → Foto selesai!" },
      { quoted: m }
    );
  },

  sticker: async (ctx) => {
    const { connection, jid, m, downloadMediaMessage } = ctx;
    if (!userSession.has(jid) && !ownerSession.has(jid))
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login!",
      });
    const { createSticker, StickerTypes } = require("wa-sticker-formatter");
    const isImg = !!m.message.imageMessage;
    const isVid = !!m.message.videoMessage;
    if (!isImg && !isVid)
      return await connection.sendMessage(
        jid,
        { text: "❗ Balas foto/video (max 10 detik) untuk jadikan stiker!" },
        { quoted: m }
      );
    const media = await downloadMediaMessage(m);
    const stiker = await createSticker(media, {
      pack: "WhiteBot",
      author: "By Owner",
      type: isVid ? StickerTypes.DEFAULT : StickerTypes.DEFAULT,
      quality: 30,
    });
    await connection.sendMessage(jid, stiker, { quoted: m });
  },

  help: async (ctx) => {
    const { connection, jid, sender } = ctx;
    const cmds = listCommands(false); // pakai versi "user" (tidak ada owner)
    const lines = cmds
      .map((cmd) => {
        const doc =
          (module.exports[cmd].toString().match(/\/\*\s*(.*?)\s*\*\//) ||
            [])[1] || "Tanpa deskripsi";
        return `• .${cmd}  –  ${doc}`;
      })
      .join("\n");
    const msg = `*📜 Daftar Fitur WhiteBot*\n\n${lines}\n\n💡 *Cara pakai:*\nUser wajib login dulu → .login <token>\nOwner → .ownerlogin\n\n*Login wajib setiap restart bot.*`;
    await connection.sendMessage(jid, { text: msg });
  },

};
