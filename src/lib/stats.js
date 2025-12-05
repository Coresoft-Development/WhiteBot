/* src/lib/stats.js  –– temporary in-memory counter */
const fs = require('fs-extra');
const path = require('path');
const FILE = path.join(__dirname, '../tmp/stats.json');

let data = { msg_today: 0, user_today: 0, users: [], date: '' };

/* load */
(async () => {
  await fs.ensureFile(FILE);
  try { data = { ...data, ...await fs.readJson(FILE) }; } catch {}
})();

/* reset harian */
const TODAY = () => new Date().toISOString().slice(0, 10);
if (data.date !== TODAY()) {
  data.date = TODAY();
  data.msg_today = 0;
  data.user_today = 0;
}
const save = () => fs.writeJson(FILE, data);

module.exports = {
  hitMsg: () => { data.msg_today++; save(); },
  addUser: (jid) => {
    const id = jid.split('@')[0];
    if (!data.users.includes(id)) {
      data.users.push(id);
      data.user_today++;
      save();
    }
  },
  todayStats: () => ({ msg_today: data.msg_today, user_today: data.user_today }),
  countUsers: () => data.users.length
};