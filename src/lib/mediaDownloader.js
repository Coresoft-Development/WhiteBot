const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

async function downloadMediaMessage(msg) {
  const type = Object.keys(msg.message)[0].replace("Message", "");
  const mediaKey = msg.message[type];
  const stream = await downloadContentFromMessage(mediaKey, type === "image" ? "image" : type);
  let buffer = Buffer.from([]);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return buffer;
}

module.exports = { downloadMediaMessage };