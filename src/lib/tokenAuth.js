/* tokenAuth.js  –– generate & verify token (now with durasi & limit) */
const fs = require('fs-extra');
const path = require('path');
const TOKEN_FILE = path.join(__dirname, '../tmp/tokens.json');

let tokens = {};   // { token: {jid, type, expire, limit}, ... }

(async () => {
  await fs.ensureFile(TOKEN_FILE);
  try { tokens = { ...tokens, ...await fs.readJson(TOKEN_FILE) }; } catch {}
})();

const save = () => fs.writeJson(TOKEN_FILE, tokens);

module.exports = {
  /* buat token baru */
  create() {
    return (Math.random() + 1).toString(36).slice(2, 10);
  },
  /* simpan object */
  set(token, data) {
    tokens[token] = data;
    save();
  },
  /* ambil object */
  get(token) {
    const d = tokens[token];
    if (!d) return null;
    // backward: string lama → object
    if (typeof d === "string") return { jid: d, type: "FREE", limit: 10 };
    return d;
  },
  /* hapus token */
  del(token) {
    delete tokens[token];
    save();
  },
  /* ambil semua token */
  getAll() {
    return tokens;
  }
};