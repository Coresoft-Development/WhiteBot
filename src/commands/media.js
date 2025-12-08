/**
 * WhiteBot Media Commands  ✅ v1.3.0  |  REWORK
 * - kirim gambar/video/audio/stiker/dokumen via URL
 * - baru: stiker dari media yang dibalas (tanpa url)
 * - anti-spam 1.5 detik
 */
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { log } = require("../utils");
const { downloadMediaMessage } = require("../lib/mediaDownloader");
const { createSticker, StickerTypes } = require("wa-sticker-formatter");
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/* ---------- helper download buffer ---------- */
const download = async (url) => {
  const { data } = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(data);
};

module.exports = {
  /* ------------------------------------------------------
   * 1. KIRIM GAMBAR (lokal atau URL)
   * ------------------------------------------------------ */
  img: async ({ connection, jid, args }) => {
    const url = args[0];
    let buffer;
    if (url) {
      buffer = await download(url);
    } else {
      const file = path.join(__dirname, "../../media/sample.jpg");
      if (!fs.existsSync(file))
        return connection.sendMessage(jid, {
          text: "❗ File sample.jpg tidak ditemukan.",
        });
      buffer = fs.readFileSync(file);
    }
    await connection.sendMessage(jid, {
      image: buffer,
      caption: "Gambar dari WhiteBot 📸",
    });
    await delay(1500);
  },

  /* ------------------------------------------------------
   * 2. KIRIM VIDEO
   * ------------------------------------------------------ */
  video: async ({ connection, jid, args }) => {
    const url = args[0];
    if (!url)
      return connection.sendMessage(jid, { text: "❗ Gunakan: .video <url>" });
    const buffer = await download(url);
    await connection.sendMessage(jid, {
      video: buffer,
      caption: "Video dari WhiteBot 🎥",
    });
    await delay(1500);
  },

  /* ------------------------------------------------------
   * 3. VOICE NOTE (ptt)
   * ------------------------------------------------------ */
  audio: async ({ connection, jid, args }) => {
    const url = args[0];
    if (!url)
      return connection.sendMessage(jid, { text: "❗ Gunakan: .audio <url>" });
    const buffer = await download(url);
    await connection.sendMessage(jid, {
      audio: buffer,
      mimetype: "audio/mp4",
      ptt: true,
    });
    await delay(1500);
  },

  /* ------------------------------------------------------
   * 4. STICKER – 2 MODE:
   *    .sticker <url>        → pakai URL (lama)
   *    .sticker (reply)      → pakai media yang dibalas (baru)
   * ------------------------------------------------------ */
  sticker: async ({ connection, jid, args, m }) => {
    const url = args[0];

    /* Mode 1: pakai URL */
    if (url) {
      const buffer = await download(url);
      await connection.sendMessage(jid, { sticker: buffer }, { quoted: m });
      return delay(1500);
    }

    /* Mode 2: pakai media yang dibalas */
    const isImg = !!m.message.imageMessage;
    const isVid = !!m.message.videoMessage;
    if (!isImg && !isVid) {
      return connection.sendMessage(
        jid,
        { text: "❗ Balas foto/video (max 10 detik) untuk jadikan stiker!" },
        { quoted: m }
      );
    }

    const media = await downloadMediaMessage(m);
    const stiker = await createSticker(media, {
      pack: "WhiteBot",
      author: "By Owner",
      type: StickerTypes.DEFAULT,
      quality: 30,
    });
    await connection.sendMessage(jid, stiker, { quoted: m });
    await delay(1500);
  },

  /* ------------------------------------------------------
   * 5. DOKUMEN (pdf, xlsx, dll)
   * ------------------------------------------------------ */
  doc: async ({ connection, jid, args }) => {
    const url = args[0];
    const fileName = args[1] || "document.pdf";
    if (!url)
      return connection.sendMessage(jid, {
        text: "❗ Gunakan: .doc <url> [namaFile]",
      });
    const buffer = await download(url);
    await connection.sendMessage(
      jid,
      { document: buffer, mimetype: "application/pdf", fileName },
      { quoted: m }
    );
    await delay(1500);
  },
};
