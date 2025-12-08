const ownerSession = new Set();
const userLoginMap = new Map();
const userSession = new Set();
const autoReplyPerUser = new Map();
const autoReplyDB = new Map(); 

module.exports = {
  ownerSession,
  userLoginMap,
  userSession,
  autoReplyPerUser,
  autoReplyDB 
};