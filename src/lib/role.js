const { ownerSession, userSession } = require("./sessionStore");

function getRole(jid) {
  if (ownerSession.has(jid)) return "owner";
  if (userSession.has(jid)) return "member";
  return null;
}

function isOwner(jid) { return getRole(jid) === "owner"; }
function isMember(jid) { return getRole(jid) === "member"; }

module.exports = { getRole, isOwner, isMember };