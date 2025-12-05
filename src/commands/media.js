/**
 * WhiteBot Media Commands  ✅ v1.2.0  |  MAX-UPDATE
 * - kirim gambar/video/audio/sticker/dokumen
 * - caption otomatis + quoted
 * - auto-download URL (image/video) lalu kirim
 * - anti-spam 1.5 detik antar media
 */
const fs   = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { log } = require('../utils');
const delay = ms => new Promise(res => setTimeout(res, ms));

/* ---------- 1. HELPER DOWNLOAD (buffer) ---------- */
const download = async (url) => {
  const { data } = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(data);
};

/* ---------- 2. MEDIA COMMANDS ---------- */
module.exports = {
  /* ------------------------------------------------------
   * 2a. KIRIM GAMBAR (lokal atau URL)
   *    .img <url>  atau  .img  -> pakai file default
   * ------------------------------------------------------ */
  img: async ({ connection, jid, args }) => {
    const url = args[0];
    let buffer;

    if (url) {
      buffer = await download(url);
    } else {
      // pakai gambar default di media/sample.jpg
      const file = path.join(__dirname, '../../media/sample.jpg');
      if (!fs.existsSync(file)) return connection.sendMessage(jid, { text: '❗ File sample.jpg tidak ditemukan.' });
      buffer = fs.readFileSync(file);
    }

    await connection.sendMessage(jid, { image: buffer, caption: 'Gambar dari WhiteBot 📸' });
    await delay(1500);
  },

  /* ------------------------------------------------------
   * 2b. KIRIM VIDEO
   * ------------------------------------------------------ */
  video: async ({ connection, jid, args }) => {
    const url = args[0];
    if (!url) return connection.sendMessage(jid, { text: '❗ Gunakan: .video <url>' });

    const buffer = await download(url);
    await connection.sendMessage(jid, { video: buffer, caption: 'Video dari WhiteBot 🎥' });
    await delay(1500);
  },

  /* ------------------------------------------------------
   * 2c. KIRIM AUDIO (voice note)
   * ------------------------------------------------------ */
  audio: async ({ connection, jid, args }) => {
    const url = args[0];
    if (!url) return connection.sendMessage(jid, { text: '❗ Gunakan: .audio <url>' });

    const buffer = await download(url);
    await connection.sendMessage(jid, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
    await delay(1500);
  },

  /* ------------------------------------------------------
   * 2d. KIRIM STICKER (image → sticker)
   * ------------------------------------------------------ */
  sticker: async ({ connection, jid, args }) => {
    const url = args[0];
    if (!url) return connection.sendMessage(jid, { text: '❗ Gunakan: .sticker <url>' });

    const buffer = await download(url);
    await connection.sendMessage(jid, { sticker: buffer });
    await delay(1500);
  },

  /* ------------------------------------------------------
   * 2e. KIRIM DOKUMEN (pdf, xlsx, dll)
   * ------------------------------------------------------ */
  doc: async ({ connection, jid, args }) => {
    const url = args[0];
    const fileName = args[1] || 'document.pdf';
    if (!url) return connection.sendMessage(jid, { text: '❗ Gunakan: .doc <url> [namaFile]' });

    const buffer = await download(url);
    await connection.sendMessage(jid, { document: buffer, mimetype: 'application/pdf', fileName });
    await delay(1500);
  }
};