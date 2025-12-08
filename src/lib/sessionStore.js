const ownerSession = new Set();
const userLoginMap = new Map();
const userSession = new Set();
const autoReplyPerUser = new Map();
const autoReplyDB = new Map();
const memberLimit = new Map();
const memberLimitGet = (jid) => memberLimit.get(jid);
const memberLimitSet = (jid, data) => memberLimit.set(jid, data);
const memberLimitDel = (jid) => memberLimit.delete(jid);

module.exports = {
  ownerSession,
  userLoginMap,
  userSession,
  autoReplyPerUser,
  autoReplyDB,
  memberLimit,
  memberLimitGet,
  memberLimitSet,
  memberLimitDel,
};
