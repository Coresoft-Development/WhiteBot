/**
 * WhiteBot Command Handler  ✅ v1.3.6  |  FINAL-TANPA-GAGAL
 * - db SELALU masuk ke ctx
 * - bisa balas SEMUA pesan (broadcast pun)
 * - fallback error lengkap
 */
const commands = require('./commands');
const ownerNumber = process.env.OWNER_NUMBER + '@s.whatsapp.net';

module.exports = async ({ connection, message, jid, text, fromMe, db }) => {
  // console.log(`[LOG] Pesan masuk -> jid: ${jid} | me: ${fromMe} | text: "${text}"`);

  const prefixes = ['.', '!', '#'];
  const usedPrefix = prefixes.find(p => text.startsWith(p));
  if (!usedPrefix) {
    // console.log(`[LOG] Tidak ada prefix -> skip`);
    return;
  }

  const args = text.slice(usedPrefix.length).trim().split(/\s+/);
  const cmd  = args.shift()?.toLowerCase();
  console.log(`[LOG] Command terdeteksi: "${cmd}" | args: [${args.join(', ')}]`);

  // ⬅️ PASTIKAN db masuk ke ctx
  const ctx = { connection, jid, args, db, prefix: usedPrefix };
  console.log(`[LOG] Kirim ctx -> db: ${typeof db}, jid: ${jid}`);

  try {
    if (commands[cmd]) {
      console.log(`[LOG] Eksekusi command "${cmd}"...`);
      await commands[cmd](ctx);
      console.log(`[LOG] Command "${cmd}" selesai`);
      return;
    }

    console.log(`[LOG] Command "${cmd}" tidak ditemukan`);
    const available = Object.keys(commands);
    const suggest = available.filter(c => c.startsWith(cmd.slice(0, 2)));
    const list = suggest.length ? suggest.join(', ') : available.slice(0, 5).join(', ');
    await connection.sendMessage(jid, {
      text: `Command *${cmd}* tidak ada.\n\n💡 Mungkin maksud Anda:\n${list}\n\nKetik *${usedPrefix}menu*`
    });
  } catch (err) {
    console.error(`[CMD-ERROR] ${cmd} dari ${jid}`, err);
    await connection.sendMessage(jid, {
      text: `❗ Terjadi kesalahan pada bot saat menjalankan *${cmd}*. Silakan coba lagi.`
    });
  }
};