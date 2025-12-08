const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const axios = require("axios"); 
const ffmpeg = require("fluent-ffmpeg"); 
const sharp = require("sharp"); 
const { createSticker, StickerTypes } = require("wa-sticker-formatter"); 
const stats = require("../lib/stats");
const tokenAuth = require("../lib/tokenAuth"); 
const ownerAuth = require("../lib/ownerAuth"); 
const { realNumber } = require("../lib/numberHelper");
const { getRole, isOwner } = require("../lib/role");
const { doLogout } = require("../lib/logout");

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const autoReplyDB = new Map();
const floodMap = new Map(); 
const PROMOTE_COOLDOWN = 5000;
const FLOOD_LIMIT = 5; 
const FLOOD_WINDOW = 10000; 

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
  
  ownerlogin: async (ctx) => {
    const { connection, jid, text } = ctx;
    if (getRole(jid))
      return await connection.sendMessage(jid, {
        text: "❗ Kamu sudah login! Tidak perlu login lagi.",
      });
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
    if (!getRole(jid))
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login sebagai owner.",
      });

    doLogout(jid);
    ownerAuth.logout(); // kalau ada
    await connection.sendMessage(jid, { text: "✅ Owner logout berhasil." });
  },

  gettoken: async (ctx) => {
    const { connection, jid } = ctx;
    if (!isOwner(jid))
      // ← baru
      return await connection.sendMessage(jid, {
        text: "❌ Fitur ini khusus owner saja!",
      });
    if (!ownerSession.has(jid))
      return await connection.sendMessage(jid, {
        text: "❗ Owner harus login dulu!",
      });

    const t = tokenAuth.create();
    tokenAuth.set(t, "FREE"); // ← FREE = bisa dipakai siapa saja
    await connection.sendMessage(jid, {
      text: `✅ Token baru: ${t}\nKirim ke user yang ingin pakai bot.`,
    });
  },

  revoke: async (ctx) => {
    const { connection, jid, text } = ctx;
    if (!isOwner(jid))
      return await connection.sendMessage(jid, {
        text: "❌ Fitur ini khusus owner!",
      });

    const token = text.trim().split(" ")[1];
    if (!token)
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .revoke ABCD1234",
      });

    const val = tokenAuth.get(token);
    if (!val)
      return await connection.sendMessage(jid, {
        text: "❓ Token tidak ditemukan.",
      });

    // Kalau sedang dipakai, kick user
    if (val !== "FREE" && val !== "REVOKED") {
      userSession.delete(val);
      userLoginMap.delete(token);
    }

    tokenAuth.set(token, "REVOKED");
    await connection.sendMessage(jid, {
      text: `✅ Token *${token}* dicabut & user otomatis logout.`,
    });
  },

  login: async (ctx) => {
    const { connection, jid, text, m } = ctx;
    const realJid = realNumber(jid, m?.key?.participant);

    // 1. Sudah login (owner/member) → tolak
    if (getRole(realJid))
      return await connection.sendMessage(jid, {
        text: "❗ Kamu sudah login! Silakan logout dulu.",
      });

    // 2. Ambil token
    const args = text.trim().split(/\s+/);
    const token = args[1];
    if (!token)
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .login <token>",
      });

    // 3. Validasi token
    const val = tokenAuth.get(token);
    if (!val)
      return await connection.sendMessage(jid, {
        text: "❌ Token tidak ditemukan.",
      });
    if (val === "REVOKED") {
      tokenAuth.del(token);
      return await connection.sendMessage(jid, {
        text: "❌ Token telah dicabut.",
      });
    }
    if (val !== "FREE")
      return await connection.sendMessage(jid, {
        text: "❌ Token sudah dipakai user lain.",
      });

    // 4. Tukar FREE → jid user
    tokenAuth.set(token, realJid);
    userLoginMap.set(token, realJid);
    userSession.add(realJid);

    await connection.sendMessage(jid, {
      text: "✅ Login berhasil! Sekarang kamu bisa pakai semua fitur bot.",
    });
  },

  logout: async (ctx) => {
    const { connection, jid } = ctx;
    const role = doLogout(jid);
    if (!role)
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login.",
      });

    await connection.sendMessage(jid, {
      text: "✅ Member logout berhasil. Token bisa dipakai lagi.",
    });
  },

  menu: async (ctx) => {
    const { connection, jid, db, sender } = ctx;

    const realJid = realNumber(jid, ctx.m?.key?.participant);
    if (!userSession.has(realJid) && !ownerSession.has(realJid)) {
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login!",
      });
    }

    const userName = (realJid || "").split("@")[0] || "user";
    const stat = stats.todayStats();
    const total = stats.countUsers();
    const ram = fmtBytes(process.memoryUsage().rss);
    const uptime = upTime(process.uptime());
    const role = getRole(realJid); // "owner" | "member"
    const roleText = role === "owner" ? "🛠️ Owner" : "👤 Member";

    const waktuSrv = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
    });

    const text = `Hai @${userName} 👋, *${process.env.BOT_NAME}* siap membantu!
*Role Kamu:* ${roleText}

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

Ketik command di diatas untuk mencoba fitur WhiteBot. ABACDE`;

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
        text: `*Ping!* ⚡\n├ Latency : ${latency} ms\n└ Server  : ${
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
├ Version : 1.6.1
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

  // addreply: async (ctx) => {
  //   const { connection, jid, text } = ctx;
  //   if (!text.includes("|"))
  //     return await connection.sendMessage(jid, {
  //       text: "❗ Gunakan: .addreply keyword|jawaban",
  //     });
  //   const [kw, ...ansArr] = text.slice(10).split("|");
  //   const answer = ansArr.join("|").trim();
  //   if (!kw || !answer)
  //     return await connection.sendMessage(jid, {
  //       text: "❗ Gunakan: .addreply halo|Halo juga!",
  //     });
  //   autoReplyDB.set(kw.trim().toLowerCase(), answer);
  //   await connection.sendMessage(
  //     jid,
  //     {
  //       text: `✅ Auto reply ditambah:\nKeyword: *${kw.trim()}*\nJawaban: *${answer}*`,
  //     },
  //     { quoted: ctx.m }
  //   );
  // },

  // delreply: async (ctx) => {
  //   const { connection, jid, text } = ctx;
  //   const kw = text.slice(10).trim().toLowerCase();
  //   if (!kw)
  //     return await connection.sendMessage(jid, {
  //       text: "❗ Gunakan: .delreply keyword",
  //     });
  //   if (autoReplyDB.delete(kw)) {
  //     await connection.sendMessage(
  //       jid,
  //       { text: `✅ Keyword *${kw}* dihapus.` },
  //       { quoted: ctx.m }
  //     );
  //   } else {
  //     await connection.sendMessage(
  //       jid,
  //       { text: `❓ Keyword *${kw}* tidak ditemukan.` },
  //       { quoted: ctx.m }
  //     );
  //   }
  // },

  // myreplyadd: async (ctx) => {
  //   const { connection, jid, text, sender } = ctx;
  //   if (!userSession.has(sender))
  //     return await connection.sendMessage(jid, {
  //       text: "❗ Kamu belum login!",
  //     });
  //   if (!text.includes("|"))
  //     return await connection.sendMessage(jid, {
  //       text: "❗ Gunakan: .myreplyadd keyword|jawaban",
  //     });
  //   const [kw, ...ansArr] = text.slice(13).split("|");
  //   const answer = ansArr.join("|").trim();
  //   if (!kw || !answer)
  //     return await connection.sendMessage(jid, {
  //       text: "❗ Gunakan: .myreplyadd halo|Halo pribadi!",
  //     });
  //   let map = autoReplyPerUser.get(sender);
  //   if (!map) {
  //     map = new Map();
  //     autoReplyPerUser.set(sender, map);
  //   }
  //   map.set(kw.trim().toLowerCase(), answer);
  //   await connection.sendMessage(
  //     jid,
  //     {
  //       text: `✅ Auto reply pribadi ditambah:\nKeyword: *${kw.trim()}*\nJawaban: *${answer}*`,
  //     },
  //     { quoted: ctx.m }
  //   );
  // },

  // myreplydel: async (ctx) => {
  //   const { connection, jid, text, sender } = ctx;
  //   if (!userSession.has(sender))
  //     return await connection.sendMessage(jid, {
  //       text: "❗ Kamu belum login!",
  //     });
  //   const kw = text.slice(15).trim().toLowerCase();
  //   if (!kw)
  //     return await connection.sendMessage(jid, {
  //       text: "❗ Gunakan: .myreplydel keyword",
  //     });
  //   const map = autoReplyPerUser.get(sender);
  //   if (map && map.delete(kw)) {
  //     await connection.sendMessage(
  //       jid,
  //       { text: `✅ Keyword pribadi *${kw}* dihapus.` },
  //       { quoted: ctx.m }
  //     );
  //   } else {
  //     await connection.sendMessage(
  //       jid,
  //       { text: `❓ Keyword pribadi *${kw}* tidak ditemukan.` },
  //       { quoted: ctx.m }
  //     );
  //   }
  // },

  tagall: async (ctx) => {
    const { connection, jid, m, text } = ctx;
    const realJid = realNumber(jid, m.key.participant);

    if (!userSession.has(realJid) && !ownerSession.has(realJid))
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login!",
      });

    // v4 Baileys → groupGetMetadata
    const group = await connection.groupGetMetadata(jid);
    const participants = Object.keys(group.participants); // { [jid]: {...} }
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

  kick: async (ctx) => {
    const { connection, jid, m, text, sock } = ctx; // <-- ambil sock langsung
    const realJid = realNumber(jid, m.key.participant);

    // 1. harus login
    if (!userSession.has(realJid) && !ownerSession.has(realJid))
      return await connection.sendMessage(
        jid,
        { text: "❗ Kamu belum login!" },
        { quoted: m }
      );

    // 2. cek target
    const num = text.trim().split(" ")[1];
    if (!num)
      return await connection.sendMessage(
        jid,
        { text: "❗ Gunakan: .kick @tag / nomor" },
        { quoted: m }
      );

    const target = num.replace(/[^\d]/g, "").slice(-12) + "@s.whatsapp.net";

    // 3. cek sock ada
    if (typeof sock?.groupParticipantsUpdate !== "function")
      return await connection.sendMessage(
        jid,
        { text: "❌ Socket tidak support kick." },
        { quoted: m }
      );

    // 4. cek target ada di grup (supaya 500 tidak muncul)
    try {
      const meta = await sock.groupGetMetadata(jid);
      if (!Object.keys(meta.participants).includes(target))
        return await connection.sendMessage(
          jid,
          { text: "❌ Target tidak ditemukan di grup." },
          { quoted: m }
        );
    } catch {
      return await connection.sendMessage(
        jid,
        { text: "❌ Gagal cek anggota grup." },
        { quoted: m }
      );
    }

    // 5. kick dengan status detail
    try {
      const result = await sock.groupParticipantsUpdate(
        jid,
        [target],
        "remove"
      );
      const status = result[0]?.status;

      if (status === 200) {
        await connection.sendMessage(
          jid,
          {
            text: `✅ @${target.split("@")[0]} telah dikick.`,
            mentions: [target],
          },
          { quoted: m }
        );
      } else if (status === 404) {
        await connection.sendMessage(
          jid,
          { text: "❌ Target tidak ditemukan." },
          { quoted: m }
        );
      } else if (status === 403) {
        await connection.sendMessage(
          jid,
          { text: "❌ Bot bukan admin / target adalah admin." },
          { quoted: m }
        );
      } else {
        await connection.sendMessage(
          jid,
          { text: `❌ Kick gagal (status ${status}).` },
          { quoted: m }
        );
      }
    } catch (e) {
      const code = e.data || e.statusCode || "???";
      console.log("[KICK SERVER ERROR]", code, e.message);
      await connection.sendMessage(
        jid,
        {
          text: `❌ Server menolak kick (kode ${code}).\nPastikan target *ada di grup* dan *bukan admin*.`,
        },
        { quoted: m }
      );
    }
  },

  location: async (ctx) => {
    const { connection, jid } = ctx;
    await connection.sendMessage(jid, {
      location: {
        degreesLatitude: -6.2,
        degreesLongitude: 106.816666,
      },
    });
  },

  // 2. KIRIM POLL/VOTING
  // poll: async (ctx) => {
  //   const { connection, jid, text } = ctx;
  //   const lines = text.trim().split("\n");
  //   if (lines.length < 3)
  //     return await connection.sendMessage(jid, {
  //       text: "❗ Gunakan:\n.poll Pertanyaan?\nOpsi A\nOpsi B",
  //     });
  //   const name = lines[0].slice(5).trim();
  //   const values = lines.slice(1);
  //   await connection.sendMessage(jid, { poll: { name, values } });
  // },

  poll: async (ctx) => {
    const { connection, jid, text } = ctx;
    const lines = text.trim().split("\n");
    if (lines.length < 3)
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan:\n.poll Pertanyaan?\nOpsi A\nOpsi B",
      });
    const name = lines[0].slice(5).trim();
    const values = lines.slice(1);
    await connection.sendMessage(jid, { poll: { name, values } });
  },

  // 3. STATUS ONLINE/TYPING/RECORDING
  online: async (ctx) => {
    const { connection, jid } = ctx;
    await connection.sendPresenceUpdate("available", jid);
    await connection.sendMessage(jid, { text: "✅ Status: Online" });
  },

  typing: async (ctx) => {
    const { connection, jid } = ctx;
    await connection.sendPresenceUpdate("composing", jid);
    await delay(3000);
    await connection.sendMessage(jid, { text: "Selesai mengetik!" });
  },

  recording: async (ctx) => {
    const { connection, jid } = ctx;
    await connection.sendPresenceUpdate("recording", jid);
    await delay(3000);
    await connection.sendMessage(jid, { text: "Selesai merekam!" });
  },

  // 4. ARSIP/MUTE/PIN CHAT
  archive: async (ctx) => {
    const { connection, jid } = ctx;
    await connection.chatModify({ archive: true }, jid);
    await connection.sendMessage(jid, { text: "✅ Chat diarsipkan." });
  },

  mute: async (ctx) => {
    const { connection, jid } = ctx;
    await connection.chatModify({ mute: 8 * 60 * 60 * 1000 }, jid); // 8 jam
    await connection.sendMessage(jid, { text: "🔇 Chat dimute 8 jam." });
  },

  pin: async (ctx) => {
    const { connection, jid } = ctx;
    await connection.chatModify({ pin: true }, jid);
    await connection.sendMessage(jid, { text: "📌 Chat dipin." });
  },

  // 5. FOTO PROFIL
  getpp: async (ctx) => {
    const { connection, jid, m } = ctx;
    const target =
      m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || jid;
    try {
      const url = await connection.profilePictureUrl(target, "image");
      await connection.sendMessage(
        jid,
        { image: { url }, caption: "Foto profil:" },
        { quoted: m }
      );
    } catch {
      await connection.sendMessage(
        jid,
        { text: "❌ Tidak ada foto profil." },
        { quoted: m }
      );
    }
  },

  // 6. CEK NOMOR ADA DI WHATSAPP
  onwa: async (ctx) => {
    const { connection, jid, text } = ctx;
    const num = text.trim().split(" ")[1];
    if (!num)
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .onwa 628xxx",
      });

    const target = num.replace(/[^\d]/g, "").slice(-12) + "@s.whatsapp.net";
    try {
      const result = await connection.onWhatsApp(target);
      if (result.length)
        await connection.sendMessage(jid, {
          text: `✅ ${num} ada di WhatsApp.`,
        });
      else
        await connection.sendMessage(jid, {
          text: `❌ ${num} tidak ada di WhatsApp.`,
        });
    } catch {
      await connection.sendMessage(jid, { text: "❌ Gagal cek nomor." });
    }
  },

  // 7. BROADCAST TEKS
  broadcast: async (ctx) => {
    const { connection, jid, text } = ctx;
    if (!isOwner(jid))
      return await connection.sendMessage(jid, {
        text: "❌ Fitur ini khusus owner!",
      });

    const pesan = text.slice(10).trim();
    if (!pesan)
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .broadcast <pesan>",
      });

    const allJids = [...userSession, ...ownerSession];
    let sent = 0;
    for (const id of allJids) {
      try {
        await connection.sendMessage(id, {
          text: `📢 *BROADCAST*\n\n${pesan}`,
        });
        sent++;
        await delay(800); // antispam
      } catch {
        // skip gagal
      }
    }
    await connection.sendMessage(jid, {
      text: `✅ Broadcast terkirim ke ${sent} orang.`,
    });
  },

  // 8. KELUAR GRUP (bot leave)
  leave: async (ctx) => {
    const { connection, jid } = ctx;
    const realJid = realNumber(jid, message.key.participant);
    if (!userSession.has(realJid) && !ownerSession.has(realJid))
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login!",
      });

    try {
      await connection.groupLeave(jid);
      await connection.sendMessage(jid, { text: "👋 Bot keluar dari grup." });
    } catch {
      await connection.sendMessage(jid, { text: "❌ Gagal keluar grup." });
    }
  },

  // 9. UNDANG MEMBER
  invite: async (ctx) => {
    const { connection, jid, m, text } = ctx;
    const realJid = realNumber(jid, m.key.participant);
    if (!userSession.has(realJid) && !ownerSession.has(realJid))
      return await connection.sendMessage(
        jid,
        { text: "❗ Kamu belum login!" },
        { quoted: m }
      );

    const num = text.trim().split(" ")[1];
    if (!num)
      return await connection.sendMessage(
        jid,
        { text: "❗ Gunakan: .invite 628xxx" },
        { quoted: m }
      );

    const target = num.replace(/[^\d]/g, "").slice(-12) + "@s.whatsapp.net";
    try {
      await connection.groupParticipantsUpdate(jid, [target], "add");
      await connection.sendMessage(
        jid,
        { text: `✅ @${target.split("@")[0]} diundang.`, mentions: [target] },
        { quoted: m }
      );
    } catch (e) {
      await connection.sendMessage(
        jid,
        {
          text: "❌ Gagal undang. Pastikan target ada di kontak & bukan anggota.",
        },
        { quoted: m }
      );
    }
  },

  // 10. KIRIM STORY (status broadcast)
  story: async (ctx) => {
    const { connection, m, downloadMediaMessage } = ctx;
    const media = await downloadMediaMessage(m);
    const jid = "status@broadcast";
    await connection.sendMessage(jid, {
      image: media,
      caption: "Story dari bot!",
    });
  },
};
