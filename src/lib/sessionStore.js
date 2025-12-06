/* Session Store – shared antara general.js & commandHandler.js */
const ownerSession = new Set();          // owner yang sudah login
const userLoginMap = new Map();          // token → userJid (1 token 1 user)
const userSession = new Set();           // userJid yang sudah login
const autoReplyPerUser = new Map();      // opsional: userJid → Map(keyword→answer)

module.exports = {
  ownerSession,
  userLoginMap,
  userSession,
  autoReplyPerUser
};