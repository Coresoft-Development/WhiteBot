/**
 * WhiteBot Command Handler  ✅ v1.3.7-fitur
 * - db SELALU masuk ke ctx
 * - bisa balas SEMUA pesan (broadcast pun)
 * - fallback error lengkap
 * - now includes: downloadMediaMessage helper
 */
const commands = require("./commands");
const ownerNumber = process.env.OWNER_NUMBER + "@s.whatsapp.net";
const { realNumber } = require('./lib/numberHelper');

// ⬇️ helper download media (foto/video)
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

const {
  ownerSession,
  userLoginMap,
  userSession,
  autoReplyPerUser,
} = require("./lib/sessionStore");
const skipLogin = [".login", "login", ".ownerlogin", "ownerlogin", ".help", "help"];

async function downloadMediaMessage(msg) {
  const type = Object.keys(msg.message)[0].replace("Message", "");
  const mediaKey = msg.message[type];
  const stream = await downloadContentFromMessage(
    mediaKey,
    type === "image" ? "image" : type
  );
  let buffer = Buffer.from([]);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return buffer;
}

module.exports = async ({ connection, message, jid, text, fromMe, db }) => {
  // anti-spam check
  if (await commands.antispam?.({ jid, fromMe })) return;
  const prefixes = [".", "!", "#"];
  const usedPrefix = prefixes.find((p) => text.startsWith(p));
  if (!usedPrefix) return;

  const args = text.slice(usedPrefix.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();
  console.log(
    `[LOG] Command terdeteksi: "${cmd}" | args: [${args.join(", ")}]`
  );

  // ctx lengkap untuk semua command
  const ctx = {
    connection,
    jid,
    text,
    sender: message.key.participant || jid,
    args,
    db,
    prefix: usedPrefix,
    m: message,
    downloadMediaMessage,
  };
  console.log(`[LOG] Kirim ctx -> db: ${typeof db}, jid: ${jid}`);

  /* LOGIN WAJIB – pakai nomor universal */
  const realSender = realNumber(jid, message.key.participant);
  const isLogin = userSession.has(realSender) || ownerSession.has(realSender);
  console.log(`[DEBUG] realSender=${realSender}, isLogin=${isLogin}, cmd=${cmd}, skip=${skipLogin.includes(cmd)}`);
  if (!skipLogin.includes(cmd) && !fromMe && !isLogin) {
    return await connection.sendMessage(jid, { text: '❗ Kamu belum login!\nUser → .login <token>\nOwner → .ownerlogin' });
  }

  /* AUTO REPLY – pakai nomor universal */
  if (!fromMe && text) {
    const realJid = realNumber(jid, message.key.participant);
    const map = autoReplyPerUser.get(realJid);
    if (map && map.has(text.toLowerCase())) {
      return await connection.sendMessage(jid, { text: map.get(text.toLowerCase()) }, { quoted: message });
    }
  }

  try {
    if (commands[cmd]) {
      console.log(`[LOG] Eksekusi command "${cmd}"...`);
      await commands[cmd](ctx);
      console.log(`[LOG] Command "${cmd}" selesai`);
      return;
    }

    console.log(`[LOG] Command "${cmd}" tidak ditemukan`);
    const available = Object.keys(commands);
    const suggest = available.filter((c) => c.startsWith(cmd.slice(0, 2)));
    const list = suggest.length
      ? suggest.join(", ")
      : available.slice(0, 5).join(", ");
    await connection.sendMessage(jid, {
      text: `Command *${cmd}* tidak ada.\n\n💡 Mungkin maksud Anda:\n${list}\n\nKetik *${usedPrefix}menu*`,
    });
  } catch (err) {
    console.error(`[CMD-ERROR] ${cmd} dari ${jid}`, err);
    await connection.sendMessage(jid, {
      text: `❗ Terjadi kesalahan pada bot saat menjalankan *${cmd}*. Silakan coba lagi.`,
    });
  }
};
