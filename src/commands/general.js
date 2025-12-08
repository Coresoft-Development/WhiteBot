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
      // token durasi – simpan expire
      memberLimitSet(realJid, { type: val.type, expire: val.expire });
    } else {
      // Kalau sudah pernah punya limit FREE, lanjutkan sisa; kalau belum baru 10
      const old = memberLimitGet(realJid);
      if (old && old.type === "FREE") {
        memberLimitSet(realJid, { type: "FREE", limit: old.limit });
      } else {
        memberLimitSet(realJid, { type: "FREE", limit: val.limit });
      }
    }

    tokenAuth.set(token, realJid);
    userLoginMap.set(token, realJid);
    userSession.add(realJid);
    await connection.sendMessage(jid, { text: "✅ Login berhasil!" });
  },

  logout: async (ctx) => {
    const { connection, jid } = ctx;
    const realJid = realNumber(jid, ctx.m?.key?.participant);
    const role = doLogout(realJid);
    if (!role)
      return await connection.sendMessage(jid, {
        text: "❗ Kamu belum login.",
      });

    /* 1. Hapus session */
    userSession.delete(realJid);
    ownerSession.delete(realJid);

    /* 2. Kembalikan token FREE agar bisa dipakai lagi */
    for (const [tok, uid] of userLoginMap.entries()) {
      if (uid === realJid) {
        const val = tokenAuth.get(tok);
        if (val && val !== "REVOKED" && val.type === "FREE") {
          // Simpan sisa limit
          tokenAuth.set(tok, { type: "FREE", limit: val.limit });
        }
        userLoginMap.delete(tok);
        break; // cukup 1x
      }
    }

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

  osint: async (ctx) => {
    const { connection, jid, text } = ctx;
    const [tipe, ...targetArr] = text.trim().split(/\s+/);
    const target = targetArr.join(" ");
    if (!tipe || !target)
      return await connection.sendMessage(jid, {
        text: "❗ .osint <ip|domain|username|email|phone|btc|sos|sub|whois|breach|paste|iot|web|git> <target>",
      });

    const wait = await connection.sendMessage(jid, {
      text: `⏳ Sedang mengecek *${tipe}* ...`,
    });

    let out = "";
    try {
      switch (tipe) {
        /* 1. IP + ISP + Lokasi (publik) */
        case "ip":
          const { data: a } = await axios.get(
            `https://ipwho.is/${encodeURIComponent(target)}`
          );
          out = a.success
            ? `📡 IP : ${a.ip}\nNegara : ${a.country} (${a.country_code})\nISP : ${a.isp}\nOrg : ${a.org}\nKota : ${a.city}\nLat/Lon : ${a.latitude}, ${a.longitude}`
            : "❌ IP tidak valid.";
          break;

        /* 2. Domain + Sub-domain (crt.sh JSON publik) */
        case "domain":
        case "sub":
          const { data: b } = await axios.get(
            `https://crt.sh/?q=%25.${encodeURIComponent(target)}&output=json`
          );
          const subs = [
            ...new Set(
              b
                .map((r) =>
                  r.name_value.split("\n")[0].replace("*.", "").toLowerCase()
                )
                .filter((s) => s.endsWith(target))
            ),
          ].slice(0, 30);
          out = subs.length
            ? `🔍 Sub-domain (${subs.length})\n${subs.join("\n")}`
            : "❌ Tidak ada subdomain ter-index.";
          break;

        /* 3. Username 350+ situs (WMN publik) */
        case "username":
        case "sos": {
          const wmn = await axios.get(
            "https://whatsmyname.app/json/wmn-data.json"
          );
          const sites = wmn.data.data
            .filter((s) => !s.category.toLowerCase().includes("crypto"))
            .slice(0, 40);
          const urls = sites.map((s) => s.uri.replace("{|username|}", target));

          const checked = await Promise.allSettled(
            // <-- ganti nama
            urls.map((u) => axios.head(u, { timeout: 4000 }))
          );

          const ok = checked
            .map((r, i) =>
              r.value?.status === 200
                ? `✅ ${sites[i].name} – ${urls[i]}`
                : null
            )
            .filter(Boolean);

          out = ok.length
            ? `✔ ${target} ditemukan di ${ok.length} situs:\n${ok.join("\n")}`
            : `❌ ${target} tidak ditemukan di WMN top-40.`;
          break;
        }

        /* 4. Email breach (HaveIBeenPwned HTML scrape) */
        case "email":
        case "breach":
          const { data: h } = await axios.get(
            `https://haveibeenpwned.com/account/${encodeURIComponent(target)}`,
            { headers: { "User-Agent": "Mozilla/5.0" } }
          );
          const breach = h.match(/class=\"pwnedTitle.*>(.*)<\/h3>/)
            ? h.match(/class=\"pwnedTitle.*>(.*)<\/h3>/)[1].trim()
            : null;
          out = breach
            ? `📧 ${target} terbreach: ${breach}`
            : `✅ ${target} bersih (tidak terbreach).`;
          break;

        /* 5. Phone carrier (numverify scrape) */
        case "phone":
          const { data: p } = await axios.get(`https://numverify.com/`, {
            headers: { "User-Agent": "Mozilla/5.0" },
          });
          const tk = p.match(/name=\"csrfToken\" value=\"([^\"]+)\"/)?.[1];
          if (!tk) throw "Token CSRF tidak ditemukan";
          const cek = await axios.post(
            `https://numverify.com/php_helper_scripts/phone_api.php`,
            `csrfToken=${tk}&number=${encodeURIComponent(target)}`,
            {
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0",
              },
            }
          );
          const res = cek.data;
          out = res.valid
            ? `📱 ${target}\nNegara : ${res.country_name}\nCarrier : ${res.carrier}\nTipe : ${res.line_type}`
            : "❌ Nomor tidak valid.";
          break;

        /* 6. BTC balance (Blockchain.info publik) */
        case "btc":
          const { data: btc } = await axios.get(
            `https://blockchain.info/rawaddr/${encodeURIComponent(target)}`
          );
          out = `₿ Address : ${target}\nBalance : ${(
            btc.final_balance / 1e8
          ).toFixed(8)} BTC\nTx : ${btc.n_tx}`;
          break;

        /* 7. PasteBin dump (psbdmp.cc JSON publik) */
        case "paste":
          const { data: pst } = await axios.get(
            `https://psbdmp.cc/api/search/${encodeURIComponent(target)}`
          );
          const list =
            pst.data
              ?.slice(0, 10)
              .map((p) => `https://psbdmp.cc/${p.id}`)
              .join("\n") || null;
          out = list
            ? `📋 PasteBin ditemukan (${pst.data.length}):\n${list}`
            : `✅ Tidak ada paste untuk *${target}*.`;
          break;

        /* 8. IoT open port (Shodan HTML scrape) */
        case "iot":
          const { data: sho } = await axios.get(
            `https://www.shodan.io/host/${encodeURIComponent(target)}`,
            { headers: { "User-Agent": "Mozilla/5.0" } }
          );
          const ports =
            sho
              .match(/<div class=\"port\">(\d+)<\/div>/g)
              ?.map((m) => m.match(/\d+/)[0])
              .join(", ") || null;
          out = ports
            ? `🔌 Port terbuka di ${target}:\n${ports}`
            : `❌ Tidak ada port terbuka / bukan IP.`;
          break;

        /* 9. Web teknologi (Wappalyzer scrape) */
        case "web":
          const { data: wap } = await axios.get(
            `https://www.wappalyzer.com/apps/`,
            { headers: { "User-Agent": "Mozilla/5.0" } }
          );
          const tech = wap.match(
            new RegExp(`data-testid=\"app-name\"[^>]*>(${target})<`, "i")
          )
            ? "✔ Teknologi dikenali oleh Wappalyzer"
            : "❌ Teknologi tidak ditemukan.";
          out = `🌐 ${target}\n${tech}`;
          break;

        /* 10. GitHub stats (REST publik) */
        case "git":
          const { data: g } = await axios.get(
            `https://api.github.com/users/${encodeURIComponent(target)}`
          );
          out = g.message
            ? "❌ User tidak ditemukan."
            : `💻 GitHub : ${g.login}\nNama : ${g.name || "-"}\nBio : ${
                g.bio || "-"
              }\nFollower : ${g.followers}\nRepo : ${
                g.public_repos
              }\nLokasi : ${g.location || "-"}`;
          break;

        default:
          out = "❌ Tipe tidak tersedia.";
      }
    } catch (e) {
      out = `❌ Gagal / quota habis / target tidak valid.\nDetail: ${
        e.message || e
      }`;
    }

    await connection.sendMessage(jid, { text: out }, { quoted: wait });
  },

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

  archive: async (ctx) => {
    const { connection, jid } = ctx;
    await connection.chatModify({ archive: true }, jid);
    await connection.sendMessage(jid, { text: "✅ Chat diarsipkan." });
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

};
