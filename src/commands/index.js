/**
 * WhiteBot Commands Index  ✅ v1.3.3  |  FINAL
 */
const general = require("./general");
const owner = require("./owner");
const media = require("./media");

const commands = {
  ...general,
  ...owner,
  ...media,
  help: async (ctx) => {
    const list = Object.keys(commands)
      .map((c) => `• .${c}`)
      .join("\n");
    await ctx.connection.sendMessage(ctx.jid, {
      text: `*WhiteBot Command List*\n\n${list}\n\nKetik *.menu* untuk button interaktif.`,
    });
  },
};

module.exports = commands;
