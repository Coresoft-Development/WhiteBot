/**
 * WhiteBot Owner Commands  ✅ v1.2.0  |  MAX-UPDATE
 * - broadcast dengan delay antar pesan (anti spam)
 * - hitung & log berhasil / gagal
 * - tambahan command baru: status, adduser, deluser
 */
const delay = ms => new Promise(res => setTimeout(res, ms));

module.exports = {
  /* ------------------------------------------------------
   * 1. BROADCAST BERSANJATA
   *    delay 1.2 detik antar pesan (aman dari spam block)
   * ------------------------------------------------------ */
  broadcast: async ({ connection, args, db }) => {
    const text = args.join(' ');
    if (!text) return connection.sendMessage(connection.jid, { text: '❗ Gunakan: .broadcast <teks>' });

    const users = db.getAllUsers();
    let sent = 0, fail = 0;

    for (const u of users) {
      try {
        await connection.sendMessage(u.jid, { text: `📢 *WhiteBot Broadcast*\n\n${text}` });
        sent++;
        await delay(1200); // anti spam
      } catch (e) {
        fail++;
        console.log(`[BC] Gagal kirim ke ${u.jid}`);
      }
    }

    // laporan ke owner
    db.logBroadcast(connection.jid, text, sent);
    await connection.sendMessage(connection.jid, { text: `✅ Broadcast selesai\nTerkirim: ${sent}\nGagal: ${fail}` });
  },

  /* ------------------------------------------------------
   * 2. STATUS BOT (untuk owner)
   * ------------------------------------------------------ */
  status: async ({ connection, db }) => {
    const stat = db.todayStats();
    const totalUser = db.countUsers();
    const txt = `*WhiteBot Status*
📊 User hari ini: ${stat.user_today}
💬 Pesan hari ini: ${stat.msg_today}
👥 Total user: ${totalUser}`;
    await connection.sendMessage(connection.jid, { text: txt });
  },

  /* ------------------------------------------------------
   * 3. TAMBAH USER MANUAL (owner)
   * ------------------------------------------------------ */
  adduser: async ({ connection, args, db }) => {
    // .adduser 628xxx Nama
    if (args.length < 2) return connection.sendMessage(connection.jid, { text: '❗ Format: .adduser 628xxx Nama' });
    const phone = args[0].replace(/\D/g, '');
    const name  = args.slice(1).join(' ');
    const jid   = phone + '@s.whatsapp.net';

    db.addUser(jid, name, phone);
    await connection.sendMessage(connection.jid, { text: `✅ User ${phone} (${name}) ditambahkan.` });
  },

  /* ------------------------------------------------------
   * 4. HAPUS USER (owner)
   * ------------------------------------------------------ */
  deluser: async ({ connection, args, db }) => {
    const phone = args[0]?.replace(/\D/g, '');
    if (!phone) return connection.sendMessage(connection.jid, { text: '❗ Format: .deluser 628xxx' });
    const jid = phone + '@s.whatsapp.net';

    db.db.prepare('DELETE FROM users WHERE jid = ?').run(jid);
    await connection.sendMessage(connection.jid, { text: `🗑️  User ${phone} dihapus.` });
  }
};