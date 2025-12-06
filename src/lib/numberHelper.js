function realNumber(jid, participant) {
  const full = (participant || jid || '');   // biar tetap pakai domain asli
  const num  = full.split('@')[0].replace(/\D/g, '');
  const host = full.split('@')[1] || 's.whatsapp.net';
  return `${num}@${host}`;
}
module.exports = { realNumber };