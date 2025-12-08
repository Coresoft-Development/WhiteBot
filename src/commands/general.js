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
const {
  memberLimitSet,
  memberLimitGet,
  memberLimitDel,
} = require("../lib/memberLimit");

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
    const { connection, jid, text } = ctx;
    if (!isOwner(jid))
      return await connection.sendMessage(jid, {
        text: "❌ Fitur ini khusus owner!",
      });
    if (!ownerSession.has(jid))
      return await connection.sendMessage(jid, {
        text: "❗ Owner harus login dulu!",
      });

    const arg = (text.trim().split(" ")[1] || "free").toLowerCase();
    const t = tokenAuth.create();
    let info = "";

    if (arg === "free") {
      tokenAuth.set(t, { jid: "FREE", type: "FREE", limit: 10 });
      info = "✅ Token FREE: 10x perintah";
    } else {
      const durasi = {
        "3d": { ms: 3 * 24 * 60 * 60 * 1000, nama: "3 hari" },
        "1w": { ms: 7 * 24 * 60 * 60 * 1000, nama: "1 minggu" },
        "1m": { ms: 30 * 24 * 60 * 60 * 1000, nama: "1 bulan" },
        "1y": { ms: 365 * 24 * 60 * 60 * 1000, nama: "1 tahun" },
      }[arg];
      if (!durasi)
        return await connection.sendMessage(jid, {
          text: "❗ Pilihan: 3d | 1w | 1m | 1y | free",
        });

      const expire = Date.now() + durasi.ms;
      tokenAuth.set(t, { jid: "DURASI", type: arg, expire });
      info = `✅ Token ${durasi.nama} (expire ${new Date(expire).toLocaleString(
        "id-ID"
      )})`;
    }

    await connection.sendMessage(jid, { text: `${info}\nToken: *${t}*` });
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

    if (getRole(realJid))
      return await connection.sendMessage(jid, {
        text: "❗ Kamu sudah login! Silakan logout dulu.",
      });

    const args = text.trim().split(/\s+/);
    const token = args[1];
    if (!token)
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .login <token>",
      });

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

    const now = Date.now();
    if (val.type !== "FREE") {
      if (now > val.expire) {
        tokenAuth.set(token, "REVOKED");
        return await connection.sendMessage(jid, {
          text: "❌ Token sudah expired.",
        });
      }
      // simpan object expire
      memberLimitSet(realJid, { type: val.type, expire: val.expire });
    } else {
      // simpan object free
      memberLimitSet(realJid, { type: "FREE", limit: val.limit });
    }

    tokenAuth.set(token, realJid);
    userLoginMap.set(token, realJid);
    userSession.add(realJid);
    await connection.sendMessage(jid, { text: "✅ Login berhasil!" });
  },

  logout: async (ctx) => {
    const { connection, jid } = ctx;
    const role = doLogout(jid);
    if (!role)
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login.",
      });

    memberLimitDel(realJid);
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

    // --- cek limit TANPA mengurangi ---
    const lim = memberLimitGet(realJid);
    let sisaText = "";
    if (!lim) {
      sisaText = "♾️ unlimited";
    } else if (lim.type === "FREE") {
      sisaText = `🎫 Free: ${lim.limit} perintah lagi`;
    } else {
      const sisaMs = lim.expire - Date.now();
      if (sisaMs <= 0) sisaText = "⏰ Expired";
      else {
        const h = Math.floor(sisaMs / (1000 * 60 * 60));
        const d = Math.floor(h / 24);
        const m = Math.floor(h / 24 / 30);
        const y = Math.floor(m / 12);
        if (y >= 1) sisaText = `📅 Sisa: ${y} tahun`;
        else if (m >= 1) sisaText = `📅 Sisa: ${m} bulan`;
        else if (d >= 1) sisaText = `📅 Sisa: ${d} hari`;
        else sisaText = `⏳ Sisa: ${h} jam`;
      }
    }

    const text = `Hai @${userName} 👋, *${process.env.BOT_NAME}* siap membantu!
*Role Kamu:* ${roleText}

📊 *Statistik Hari Ini*
├ Pesan: ${stat.msg_today}
├ User baru: ${stat.user_today}
├ Total aktif: ${total}
├ RAM: ${ram}
├ ${sisaText}
└ Waktu server: ${waktuSrv}

💡 *Command*
├ .help     – lihat daftar lengkap
├ .ping     – cek kecepatan bot
└ .about    – info versi & owner

Ketik command di atas untuk mencoba fitur WhiteBot.`;

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
├ Version : 1.0.0
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

  whois: async (ctx) => {
    const { connection, jid, text } = ctx;
    const raw = text.trim().split(/\s+/)[1];
    if (!raw)
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .whois example.com",
      });

    // hapus protokol & path
    const target = raw.replace(/^https?:\/\//, "").split("/")[0];
    const waitMsg = await connection.sendMessage(jid, {
      text: "⏳ Sedang mengecek...",
    });

    try {
      // IPwho.is support IP maupun domain
      const { data } = await axios.get(
        `https://ipwho.is/${encodeURIComponent(target)}`,
        { timeout: 7000 }
      );

      const out = data.success
        ? `*WHOIS* ${target}\n├ IP: ${data.ip}\n├ Negara: ${data.country} (${data.country_code})\n├ ISP: ${data.isp}\n└ Org: ${data.org}`
        : "❌ Tidak ditemukan / bukan IP / domain valid.";
      await connection.sendMessage(jid, { text: out }, { quoted: waitMsg });
    } catch {
      await connection.sendMessage(
        jid,
        { text: "❌ Gagal cek (timeout)." },
        { quoted: waitMsg }
      );
    }
  },

  subdomain: async (ctx) => {
    const { connection, jid, text } = ctx;
    const domain = text.trim().split(/\s+/)[1];
    if (!domain)
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .subdomain example.com",
      });

    const waitMsg = await connection.sendMessage(jid, {
      text: "🔍 Sedang memindai sub-domain di crt.sh...",
    });

    try {
      // endpoint benar (tanpa spasi)
      const { data } = await axios.get(
        `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`,
        { timeout: 10000 }
      );

      // normalize: hilangkan wildcard & duplikat
      const subs = [
        ...new Set(
          data
            .map((r) =>
              r.name_value
                .split("\n")[0] // ambil baris pertama
                .replace(/^\*\./, "") // buang *.
                .toLowerCase()
            )
            .filter((s) => s.endsWith(`.${domain}`))
        ),
      ].slice(0, 30);

      const out = subs.length
        ? `🔍 *Sub-domain ditemukan (${subs.length})*\n${subs.join("\n")}`
        : "❌ Tidak ada sub-domain ter-index.";
      await connection.sendMessage(jid, { text: out }, { quoted: waitMsg });
    } catch {
      await connection.sendMessage(
        jid,
        { text: "❌ Gagal ambil data." },
        { quoted: waitMsg }
      );
    }
  },

  usercheck: async (ctx) => {
    const { connection, jid, text } = ctx;
    const user = text.trim().split(/\s+/)[1];
    if (!user || !/^[a-zA-Z0-9._-]{2,30}$/.test(user))
      return await connection.sendMessage(jid, {
        text: "❗ Gunakan: .usercheck namauser (tanpa spasi).",
      });

    const POPULAR = [
      { name: "Instagram", url: `https://instagram.com/${user}` },
      { name: "Facebook", url: `https://facebook.com/${user}` },
      { name: "Twitter", url: `https://twitter.com/${user}` },
      { name: "TikTok", url: `https://tiktok.com/@${user}` },
      { name: "YouTube", url: `https://youtube.com/@${user}` },
      { name: "LinkedIn", url: `https://linkedin.com/in/${user}` },
      { name: "GitHub", url: `https://github.com/${user}` },
      { name: "Reddit", url: `https://reddit.com/u/${user}` },
      { name: "Pinterest", url: `https://pinterest.com/${user}` },
      { name: "Twitch", url: `https://twitch.tv/${user}` },
      { name: "Discord", url: `https://discord.com/users/${user}` },
      { name: "Telegram", url: `https://t.me/${user}` },
      { name: "WhatsApp", url: `https://wa.me/${user}` },
      { name: "Snapchat", url: `https://snapchat.com/add/${user}` },
      { name: "Spotify", url: `https://open.spotify.com/user/${user}` },
      { name: "Google", url: `https://g.dev/${user}` },
    ];

    const OTHER = [
      { name: "Medium", url: `https://medium.com/@${user}` },
      { name: "GitLab", url: `https://gitlab.com/${user}` },
      { name: "npm", url: `https://npmjs.com/~${user}` },
      { name: "Docker Hub", url: `https://hub.docker.com/u/${user}` },
      { name: "Kaggle", url: `https://kaggle.com/${user}` },
      { name: "Steam", url: `https://steamcommunity.com/id/${user}` },
      { name: "Notion", url: `https://notion.so/@${user}` },
      { name: "CodePen", url: `https://codepen.io/${user}` },
      { name: "Replit", url: `https://replit.com/@${user}` },
      { name: "Flickr", url: `https://flickr.com/people/${user}` },
      { name: "Vimeo", url: `https://vimeo.com/${user}` },
      { name: "Behance", url: `https://behance.net/${user}` },
      { name: "Dribbble", url: `https://dribbble.com/${user}` },
      { name: "SlideShare", url: `https://slideshare.net/${user}` },
      { name: "DeviantArt", url: `https://deviantart.com/${user}` },
      { name: "BandLab", url: `https://bandlab.com/${user}` },
      { name: "SoundCloud", url: `https://soundcloud.com/${user}` },
      { name: "MySpace", url: `https://myspace.com/${user}` },
      { name: "Wattpad", url: `https://wattpad.com/user/${user}` },
      { name: "TripAdvisor", url: `https://tripadvisor.com/members/${user}` },
      { name: "Foursquare", url: `https://foursquare.com/${user}` },
      { name: "Airbnb", url: `https://airbnb.com/users/${user}` },
      { name: "Booking", url: `https://booking.com/profile/${user}` },
      { name: "Amazon", url: `https://amazon.com/gp/profile/${user}` },
      { name: "eBay", url: `https://ebay.com/usr/${user}` },
      { name: "Etsy", url: `https://etsy.com/people/${user}` },
      { name: "Patreon", url: `https://patreon.com/${user}` },
      { name: "Ko-fi", url: `https://ko-fi.com/${user}` },
      { name: "BuyMeACoffee", url: `https://buymeacoffee.com/${user}` },
      { name: "Udemy", url: `https://udemy.com/user/${user}` },
      { name: "Coursera", url: `https://coursera.org/user/${user}` },
      { name: "KhanAcademy", url: `https://khanacademy.org/profile/${user}` },
      { name: "WordPress", url: `https://${user}.wordpress.com` },
      { name: "Blogger", url: `https://${user}.blogspot.com` },
      { name: "Wix", url: `https://${user}.wixsite.com` },
      { name: "Trello", url: `https://trello.com/${user}` },
      { name: "Telegram", url: `https://t.me/${user}` },
      { name: "Signal", url: `https://signal.me/#u/${user}` },
      { name: "Viber", url: `https://viber.me/${user}` },
      { name: "Line", url: `https://line.me/R/ti/p/@${user}` },
      { name: "Snapchat", url: `https://snapchat.com/add/${user}` },
      { name: "Skype", url: `https://join.skype.com/invite/${user}` },
      { name: "Zoom", url: `https://zoom.us/u/${user}` },
      { name: "Slack", url: `https://${user}.slack.com` },
      { name: "Discord", url: `https://discord.gg/${user}` },
      { name: "Clubhouse", url: `https://clubhouse.com/@${user}` },
      { name: "TikTok", url: `https://tiktok.com/@${user}` },
      { name: "YouTube", url: `https://youtube.com/@${user}` },
      { name: "Twitch", url: `https://twitch.tv/${user}` },
      { name: "Steam", url: `https://steamcommunity.com/id/${user}` },
      {
        name: "Xbox",
        url: `https://account.xbox.com/Profile?Gamertag=${user}`,
      },
      {
        name: "PlayStation",
        url: `https://my.playstation.com/profile/${user}`,
      },
      {
        name: "EpicGames",
        url: `https://www.epicgames.com/id/help/en-US/profiles/${user}`,
      },
      { name: "Roblox", url: `https://roblox.com/user.aspx?username=${user}` },
      { name: "Minecraft", url: `https://namemc.com/profile/${user}` },
      { name: "PayPal", url: `https://paypal.com/paypalme/${user}` },
      { name: "Wise", url: `https://wise.com/invite/u/${user}` },
      { name: "Binance", url: `https://binance.com/en/user/profile/${user}` },
      { name: "Coinbase", url: `https://coinbase.com/${user}` },
      { name: "Blockchain", url: `https://blockchain.com/btc/address/${user}` },
      { name: "GitLab", url: `https://gitlab.com/${user}` },
      { name: "Bitbucket", url: `https://bitbucket.org/${user}` },
      { name: "npm", url: `https://npmjs.com/~${user}` },
      { name: "PyPI", url: `https://pypi.org/user/${user}` },
      { name: "Docker Hub", url: `https://hub.docker.com/u/${user}` },
      { name: "HackerRank", url: `https://hackerrank.com/${user}` },
      { name: "LeetCode", url: `https://leetcode.com/${user}` },
      { name: "Kaggle", url: `https://kaggle.com/${user}` },
      { name: "CodePen", url: `https://codepen.io/${user}` },
      { name: "Replit", url: `https://replit.com/@${user}` },
      {
        name: "StackOverflow",
        url: `https://stackoverflow.com/users/1/${user}`,
      },
      { name: "Medium", url: `https://medium.com/@${user}` },
      { name: "DeviantArt", url: `https://deviantart.com/${user}` },
      { name: "Behance", url: `https://behance.net/${user}` },
      { name: "Dribbble", url: `https://dribbble.com/${user}` },
      { name: "Vimeo", url: `https://vimeo.com/${user}` },
      { name: "Flickr", url: `https://flickr.com/people/${user}` },
      { name: "SlideShare", url: `https://slideshare.net/${user}` },
    ];

    /* Gabungkan – populer dicek dulu */
    const allSites = [...POPULAR, ...OTHER];

    const waitMsg = await connection.sendMessage(jid, {
      text: `⏳ Sedang mengecek username *${user}* di ${allSites.length} situs...`,
    });

    const results = [];
    const maxConcurrent = 15;
    for (let i = 0; i < allSites.length; i += maxConcurrent) {
      const chunk = allSites.slice(i, i + maxConcurrent);
      await Promise.all(
        chunk.map(async (s) => {
          try {
            const cek = await axios.head(s.url, { timeout: 5000 });
            if (cek.status < 400) results.push(`✅ ${s.name} – ${s.url}`);
            else results.push(`❌ ${s.name} – tidak ditemukan`);
          } catch {
            results.push(`❌ ${s.name} – tidak ditemukan`);
          }
        })
      );
      await new Promise((r) => setTimeout(r, 1000)); // jeda antiratelimit
    }

    const header = `🔍 *Username Check : @${user}*\n${results.length} situs diperiksa\n\n`;
    await connection.sendMessage(
      jid,
      { text: header + results.join("\n") },
      { quoted: waitMsg }
    );
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
