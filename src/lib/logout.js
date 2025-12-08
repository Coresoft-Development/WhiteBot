const { ownerSession, userSession, userLoginMap } = require("./sessionStore");

function doLogout(jid) {
  if (ownerSession.has(jid)) {
    ownerSession.delete(jid);
    return "owner";
  }
  if (userSession.has(jid)) {
    userSession.delete(jid);
    // hapus mapping token ↔ jid
    for (const [tok, id] of userLoginMap.entries()) {
      if (id === jid) userLoginMap.delete(tok);
    }
    return "member";
  }
  return null;
}

module.exports = { doLogout };