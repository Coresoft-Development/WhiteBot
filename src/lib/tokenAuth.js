/* tokenAuth.js  –– generate & verify token */
const fs = require('fs-extra');
const path = require('path');
const TOKEN_FILE = path.join(__dirname, '../tmp/tokens.json');

let tokens = {};   // { token: jid, ... }

(async () => {
  await fs.ensureFile(TOKEN_FILE);
  try { tokens = { ...tokens, ...await fs.readJson(TOKEN_FILE) }; } catch {}
})();

const save = () => fs.writeJson(TOKEN_FILE, tokens);

module.exports = {
  /* buat token baru (dipakai owner) */
  create() {
    const t = (Math.random() + 1).toString(36).slice(2, 10); // 8 karakter
    return t;
  },
  /* simpan pasangan token ↔ jid */
  set(token, jid) {
    tokens[token] = jid;
    save();
  },
  /* cek & ambil jid kalau valid */
  get(token) {
    return tokens[token]; // undefined kalau tidak ada
  },
  /* hapus token (logout) */
  del(token) {
    delete tokens[token];
    save();
  },

  getAll() {
    return tokens; // { token: jid, ... }
  }
};